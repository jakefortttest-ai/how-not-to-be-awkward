const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function tryFetchUrlContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HowNotToBeAwkward/1.0)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);
    return text || null;
  } catch {
    return null;
  }
}

// ── NEW: Smart follow-up questions ─────────────────────────────────────
app.post('/api/questions', async (req, res) => {
  const { setting, context } = req.body;

  if (!setting || !context?.trim()) {
    return res.status(400).json({ error: 'Setting and context are required.' });
  }

  const systemPrompt = `You are a social coach AI. Based on the user's described situation, generate 3-4 smart follow-up questions to better understand who they're talking to and what they need. Each question must have exactly 4 short, mutually-exclusive options (2–5 words each).

Focus areas for questions: audience age range, group size, relationship type, user's goal, audience personality/vibe, formality level, or any other factor highly relevant to the specific situation described.

Make questions feel natural and conversational, not like a form. Tailor them specifically to the situation — avoid generic questions that could apply to anything.

Respond ONLY with valid JSON. No markdown, no prose.`;

  const userPrompt = `Setting: ${setting === 'work' ? 'Work / Professional' : 'Lifestyle / Social'}
Situation: "${context.trim()}"

Generate 3-4 smart follow-up questions to personalize ice breakers and jokes for this specific situation.

JSON format:
{
  "questions": [
    {
      "id": "q1",
      "question": "Short, natural question?",
      "options": ["Option A", "Option B", "Option C", "Option D"]
    }
  ]
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid response format');

    const parsed = JSON.parse(match[0]);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('Invalid questions format');
    }

    res.json(parsed);
  } catch (err) {
    console.error('[Questions Error]', err.message);
    res.status(500).json({ error: 'Could not generate questions. Please try again.' });
  }
});

// ── Generate suggestions ────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { setting, context, url, style = 'neutral', humorType = 'balanced', answers } = req.body;

  if (!setting || !context?.trim()) {
    return res.status(400).json({ error: 'Setting and context description are required.' });
  }

  if (!['work', 'lifestyle'].includes(setting)) {
    return res.status(400).json({ error: 'Invalid setting value.' });
  }

  const styleMap = {
    formal:  'Polished, professional, and respectful — suitable for senior stakeholders.',
    casual:  'Warm, relaxed, and friendly — like talking to a good friend.',
    neutral: 'Balanced, approachable, and pleasant — broadly appropriate for most audiences.',
  };

  const humorMap = {
    balanced:        'Warm, clever, and broadly appealing — funny without being too niche.',
    dry:             'Deadpan and understated — the humor lives in what is NOT said. Poker face delivery.',
    dad:             'Groan-worthy puns and dad jokes — the cornier the better. Lean into the cringe.',
    sarcastic:       'Sharp sarcasm with real bite — witty, ironic, and a little cutting.',
    dark:            'Dark humor that finds comedy in the uncomfortable and absurd. Embrace the unexpected.',
    selfDeprecating: 'Self-deprecating humor that puts the joke firmly on the speaker — instantly disarming and relatable.',
    wordplay:        'Clever wordplay, puns, and double meanings — the more unexpected the twist the better.',
    oneLiners:       'Sharp punchy one-liners — maximum impact, minimum words. No long setup, just the hit.',
  };

  let urlContext = '';
  if (url?.trim()) {
    const content = await tryFetchUrlContent(url.trim());
    if (content) {
      urlContext = `\n\nDocument/Presentation Content (fetched from ${url}):\n"${content}"`;
    } else {
      urlContext = `\n\nPresentation URL provided (content could not be accessed): ${url}`;
    }
  }

  // Build answers context from chip selections
  let answersContext = '';
  if (answers && typeof answers === 'object') {
    const lines = Object.entries(answers)
      .filter(([, v]) => v?.trim())
      .map(([q, a]) => `  • ${q}: ${a}`)
      .join('\n');
    if (lines) {
      answersContext = `\n\nAdditional context about the audience and situation:\n${lines}`;
    }
  }

  const systemPrompt = `You are a sharp, witty social coach. Your job is to generate genuinely funny, clever ice breakers and jokes tailored to the user's exact situation.

Be ACTUALLY funny. Specific beats generic. Surprise beats predictable. Edge beats bland.
The only hard limits: no content targeting people's protected characteristics (race, religion, gender, sexuality, disability, nationality), and no hate speech or slurs. Everything else — dark humor, sarcasm, self-deprecation, edgy observations, adult wit — is fair game.

Respond ONLY with valid JSON. No markdown fences, no prose — just the JSON object.`;

  const userPrompt = `Generate genuinely funny and engaging social suggestions for the following:

Setting: ${setting === 'work' ? 'WORK — Professional, office, or business environment' : 'LIFESTYLE — Casual social, personal, or recreational environment'}
Situation: ${context.trim()}${answersContext}${urlContext}
Tone/Style: ${styleMap[style] || styleMap.neutral}
Humor Style: ${humorMap[humorType] || humorMap.balanced}

Requirements:
- Generate exactly 5 "Ice Breaker" suggestions (conversation starters, observations, engaging questions)
- Generate exactly 5 "Joke" suggestions — commit fully to the specified humor style, make them actually funny
- Each suggestion: concise and punchy (1-3 sentences max)
- Use the audience/situation context to make suggestions feel specifically crafted for this moment
- Avoid generic filler — if it could apply to any situation, rewrite it

Respond with this exact JSON structure (5 ice breakers then 5 jokes):
{
  "suggestions": [
    {"type": "Ice Breaker", "content": "..."},
    {"type": "Ice Breaker", "content": "..."},
    {"type": "Ice Breaker", "content": "..."},
    {"type": "Ice Breaker", "content": "..."},
    {"type": "Ice Breaker", "content": "..."},
    {"type": "Joke", "content": "..."},
    {"type": "Joke", "content": "..."},
    {"type": "Joke", "content": "..."},
    {"type": "Joke", "content": "..."},
    {"type": "Joke", "content": "..."}
  ]
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid AI response format');

    const parsed = JSON.parse(match[0]);
    if (!parsed.suggestions || !Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      throw new Error('Invalid suggestions structure');
    }

    res.json({ suggestions: parsed.suggestions });
  } catch (err) {
    console.error('[Generate Error]', err.message);
    res.status(500).json({ error: 'Something went wrong generating suggestions. Please try again.' });
  }
});

// ── Report ──────────────────────────────────────────────────────────────
app.post('/api/report', (req, res) => {
  const { setting, context, content, type, reason } = req.body;
  console.log('[CONTENT REPORT]', {
    timestamp: new Date().toISOString(),
    setting,
    context: context?.slice(0, 100),
    content: content?.slice(0, 200),
    type,
    reason,
  });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨ How Not To Be Awkward is running!`);
  console.log(`   Open: http://localhost:${PORT}\n`);
});
