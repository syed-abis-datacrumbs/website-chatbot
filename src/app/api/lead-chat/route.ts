import { NextResponse } from 'next/server';
import { getDb, ContactProfile, ChatMessage } from '@/lib/redis';
import { summarizeLeadChatWithAI } from '@/lib/gemini';

export async function GET(request: Request) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    if (!phone) {
      return NextResponse.json({ error: 'Phone parameter required' }, { status: 400, headers });
    }

    // Clean phone number and generate search variants (e.g. 0333..., 92333...)
    const clean = phone.replace(/\D/g, '');
    const variants = [clean];
    if (clean.startsWith('0')) {
      variants.push('92' + clean.slice(1));
    } else if (clean.startsWith('92')) {
      variants.push('0' + clean.slice(2));
    } else if (clean.startsWith('3')) {
      variants.push('92' + clean);
      variants.push('0' + clean);
    }

    const db = await getDb();
    const msgs = await db.collection<ChatMessage>('wa_messages')
      .find({ from: { $in: variants } })
      .sort({ timestamp: 1 })
      .toArray();

    // Check if the student actually replied
    // (Ignore automated outgoing template records)
    const studentReplies = msgs.filter((m: ChatMessage) => {
      const text = (m.text || '').trim();
      if (!text) return false;
      if (text.startsWith('[template:') || text.startsWith('Template:') || text === '[lead_welcome]') return false;
      return true;
    });

    if (studentReplies.length === 0) {
      return NextResponse.json({
        hasChat: false,
        message: 'No student reply yet',
      }, { headers });
    }

    // Optional profile metadata (search all phone variants)
    const profile = await db.collection<ContactProfile>('contact_profiles').findOne({
      phone: { $in: variants },
    });

    // Check cached summary or generate once via AI
    let summary = profile?.chatSummary;
    const cachedMsgCount = profile?.chatSummaryMsgCount || 0;

    if (!summary || studentReplies.length > cachedMsgCount) {
      try {
        summary = await summarizeLeadChatWithAI(
          msgs.map((m: ChatMessage) => ({ text: m.text, reply: m.reply })),
          profile ? {
            name: profile.name,
            goal: profile.bootcampGoal,
            background: profile.bootcampBackground,
          } : null
        );

        // Cache summary in MongoDB so future views load in 0ms with 0 tokens
        await db.collection('contact_profiles').updateOne(
          { phone: { $in: variants } },
          {
            $set: {
              chatSummary: summary,
              chatSummaryMsgCount: studentReplies.length,
              chatSummaryUpdatedAt: Date.now(),
            },
            $setOnInsert: {
              phone: clean,
              nameAsked: false,
              botDisabled: false,
              updatedAt: Date.now(),
            },
          },
          { upsert: true }
        );
      } catch (sumErr) {
        console.warn('[lead-chat] Summarization generation error:', sumErr);
      }
    }

    const formattedMessages = msgs.map((m: ChatMessage) => ({
      text: m.text,
      reply: m.reply,
      timestamp: m.timestamp,
      mediaType: m.mediaType,
      timeStr: new Date(m.timestamp).toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      }),
    }));

    const lastStudentMsg = studentReplies[studentReplies.length - 1];

    return NextResponse.json({
      hasChat: true,
      summary: summary || null,
      totalMessages: msgs.length,
      studentRepliesCount: studentReplies.length,
      lastStudentMessage: lastStudentMsg.text,
      lastStudentMessageTime: new Date(lastStudentMsg.timestamp).toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      }),
      profile: profile ? {
        name: profile.name,
        goal: profile.bootcampGoal,
        background: profile.bootcampBackground,
        hasDiscountRequest: profile.hasSubmittedDiscountRequest,
        hasDemoRequest: profile.hasSubmittedDemoRequest,
      } : null,
      messages: formattedMessages,
    }, { headers });
  } catch (err: any) {
    console.error('[lead-chat] Error fetching chat:', err);
    return NextResponse.json({ hasChat: false, error: err.message }, { status: 500, headers });
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
