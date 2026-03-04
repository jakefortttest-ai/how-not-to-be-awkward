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

// ── Shared prompt data ──────────────────────────────────────────────────
const STYLE_MAP = {
  en: {
    formal:  'Polished, professional, and respectful — suitable for senior stakeholders.',
    casual:  'Warm, relaxed, and friendly — like talking to a good friend.',
    neutral: 'Balanced, approachable, and pleasant — broadly appropriate for most audiences.',
  },
  zh: {
    formal:  '正式、专业、得体——适合与领导或重要客户沟通的场合。',
    casual:  '轻松、亲切、接地气——像和好朋友说话一样自然。',
    neutral: '适中、随和——大多数场合都适用的风格。',
  },
};

const HUMOR_MAP = {
  en: {
    balanced:        'Warm, clever, and broadly appealing — funny without being too niche.',
    dry:             'Deadpan and understated — the humor lives in what is NOT said. Poker face delivery.',
    dad:             'Groan-worthy puns and dad jokes — the cornier the better. Lean into the cringe.',
    sarcastic:       'Sharp sarcasm with real bite — witty, ironic, and a little cutting.',
    dark:            'Dark humor that finds comedy in the uncomfortable and absurd. Embrace the unexpected.',
    selfDeprecating: 'Self-deprecating humor that puts the joke firmly on the speaker — instantly disarming and relatable.',
    wordplay:        'Clever wordplay, puns, and double meanings — the more unexpected the twist the better.',
    oneLiners:       'Sharp punchy one-liners — maximum impact, minimum words. No long setup, just the hit.',
    misdirect:       'Bait-and-switch humor — set up an obvious expectation, then pull the rug out with a completely unexpected punchline.',
    popCulture:      'Riffs on current memes, trending pop culture, viral moments, or recent events. Keep references fresh and recognizable.',
  },
  zh: {
    balanced:        '温和幽默，雅俗共赏——好笑但不出格，适合大多数人。',
    dry:             '冷幽默，一本正经说段子——面不改色，内伤极深，越平静越好笑。',
    dad:             '老爸式冷笑话——专门让人尴尬窒息，越土越好，必须尬到飞起。',
    sarcastic:       '吐槽风，带刺但有趣——犀利、反讽、有点嘴欠，让人忍不住笑。',
    dark:            '阴间笑话，黑色幽默——在令人不适的地方找到喜感，越出乎意料越好。',
    selfDeprecating: '自嘲文化——把笑点全砸在自己身上。打工人式自嘲、内卷受害者体，瞬间拉近距离。',
    wordplay:        '谐音梗、文字游戏——充分利用汉语谐音和多义词制造笑点，越绕越妙。',
    oneLiners:       '一句话段子——字少事大，不废话，直接命中，后劲十足。',
    misdirect:       '反转梗——先铺垫显而易见的走向，然后突然拐弯，出乎意料才是精髓。',
    popCulture:      '热梗/时事梗——结合当下网络流行语、热门话题和社会事件，越及时越接地气越好。',
  },
};

// ── Smart follow-up questions ───────────────────────────────────────────
app.post('/api/questions', async (req, res) => {
  const { setting, context, language = 'en' } = req.body;
  const isZh = language === 'zh';

  if (!setting || !context?.trim()) {
    return res.status(400).json({ error: isZh ? '场景和情况描述不能为空。' : 'Setting and context are required.' });
  }

  const systemPrompt = isZh
    ? `你是一个社交顾问AI。根据用户描述的场景，生成3-4个智能追问，以更好地了解对象和用户需求。每个问题必须有恰好4个简短的、互斥的选项（每个选项2-6个字）。

提问重点：年龄段、群体规模、关系类型、用户目标、对象性格/氛围、正式程度，或其他与该具体情况高度相关的因素。

问题要自然、口语化，不要像表单。紧贴具体场景——避免适用于任何场合的通用问题。

只返回有效的JSON，不要输出markdown标记或其他文字。`
    : `You are a social coach AI. Based on the user's described situation, generate 3-4 smart follow-up questions to better understand who they're talking to and what they need. Each question must have exactly 4 short, mutually-exclusive options (2–5 words each).

Focus areas: audience age range, group size, relationship type, user's goal, audience personality/vibe, formality level, or any other factor highly relevant to the specific situation.

Make questions feel natural and conversational, not like a form. Tailor them specifically to the situation.

Respond ONLY with valid JSON. No markdown, no prose.`;

  const settingLabel = isZh
    ? (setting === 'work' ? '职场/工作场合' : '生活/社交场合')
    : (setting === 'work' ? 'Work / Professional' : 'Lifestyle / Social');

  const userPrompt = isZh
    ? `场景类型：${settingLabel}\n情况描述："${context.trim()}"\n\n为这个具体情况生成3-4个智能追问，以便个性化开场白和段子。\n\nJSON格式：\n{\n  "questions": [\n    {\n      "id": "q1",\n      "question": "简短自然的问题？",\n      "options": ["选项A", "选项B", "选项C", "选项D"]\n    }\n  ]\n}`
    : `Setting: ${settingLabel}\nSituation: "${context.trim()}"\n\nGenerate 3-4 smart follow-up questions to personalize ice breakers and jokes for this specific situation.\n\nJSON format:\n{\n  "questions": [\n    {\n      "id": "q1",\n      "question": "Short, natural question?",\n      "options": ["Option A", "Option B", "Option C", "Option D"]\n    }\n  ]\n}`;

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
    res.status(500).json({ error: isZh ? '无法生成问题，请重试。' : 'Could not generate questions. Please try again.' });
  }
});

// ── Generate suggestions ────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { setting, context, url, style = 'neutral', humorType = 'balanced', answers, language = 'en' } = req.body;
  const isZh = language === 'zh';

  if (!setting || !context?.trim()) {
    return res.status(400).json({ error: isZh ? '场景和情况描述不能为空。' : 'Setting and context description are required.' });
  }

  if (!['work', 'lifestyle'].includes(setting)) {
    return res.status(400).json({ error: 'Invalid setting value.' });
  }

  const styleMap = STYLE_MAP[isZh ? 'zh' : 'en'];
  const humorMap = HUMOR_MAP[isZh ? 'zh' : 'en'];

  let urlContext = '';
  if (url?.trim()) {
    const content = await tryFetchUrlContent(url.trim());
    if (content) {
      urlContext = isZh
        ? `\n\n文档/演示内容（来自 ${url}）：\n"${content}"`
        : `\n\nDocument/Presentation Content (fetched from ${url}):\n"${content}"`;
    } else {
      urlContext = isZh
        ? `\n\n已提供演示链接（无法访问内容）：${url}`
        : `\n\nPresentation URL provided (content could not be accessed): ${url}`;
    }
  }

  let answersContext = '';
  if (answers && typeof answers === 'object') {
    const lines = Object.entries(answers)
      .filter(([, v]) => v?.trim())
      .map(([q, a]) => `  • ${q}: ${a}`)
      .join('\n');
    if (lines) {
      answersContext = isZh
        ? `\n\n关于受众和场景的补充信息：\n${lines}`
        : `\n\nAdditional context about the audience and situation:\n${lines}`;
    }
  }

  const systemPrompt = isZh
    ? `你是一个幽默风趣、接地气的社交顾问。你的任务是生成真正好笑、有创意的开场白和段子，完全针对中国文化背景和中国受众。

核心原则：
- 必须用中文输出所有内容
- 内容要原汁原味、接地气，像本地中国人说话，绝非翻译腔
- 善用：谐音梗、网络流行语（yyds、绝绝子、躺平、内卷、打工人、i人e人等）、成语活用、段子文化
- 结合中国具体文化语境（职场文化、饮食、节日、地域特色、流行娱乐等）
- 唯一限制：不涉及民族、宗教、性别、残疾等保护性特征的歧视内容

只返回有效的JSON，不要输出markdown标记或其他文字。`
    : `You are a sharp, witty social coach. Your job is to generate genuinely funny, clever ice breakers and jokes tailored to the user's exact situation.

Be ACTUALLY funny. Specific beats generic. Surprise beats predictable. Edge beats bland.
The only hard limits: no content targeting people's protected characteristics (race, religion, gender, sexuality, disability, nationality), and no hate speech or slurs. Everything else — dark humor, sarcasm, self-deprecation, edgy observations, adult wit — is fair game.

Respond ONLY with valid JSON. No markdown fences, no prose — just the JSON object.`;

  const settingLabel = isZh
    ? (setting === 'work' ? '职场/工作场合（办公室、会议、职业活动等）' : '生活/社交场合（聚会、约会、社交活动、新认识朋友等）')
    : (setting === 'work' ? 'WORK — Professional, office, or business environment' : 'LIFESTYLE — Casual social, personal, or recreational environment');

  const userPrompt = isZh
    ? `为以下场景生成真正好笑、有创意的社交内容：

场景类型：${settingLabel}
具体情况：${context.trim()}${answersContext}${urlContext}
语气风格：${styleMap[style] || styleMap.neutral}
幽默风格：${humorMap[humorType] || humorMap.balanced}

要求：
- 生成恰好5个"Ice Breaker"开场白（暖场话、破冰话题、互动问题或观察性话语）
- 生成恰好5个"Joke"段子——完全按照指定幽默风格，要真正好笑
- 每条内容简洁有力（1-3句话为佳）
- 内容要针对这个具体场景量身定制，拒绝废话套话
- 多用地道中文表达和中国文化元素，比如热梗、谐音、自嘲文化等

返回以下JSON格式（5个开场白，然后5个段子）：
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
}`
    : `Generate genuinely funny and engaging social suggestions for the following:

Setting: ${settingLabel}
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
    res.status(500).json({ error: isZh ? '生成内容时出错，请重试。' : 'Something went wrong generating suggestions. Please try again.' });
  }
});

// ── Replace a single thumbed-down suggestion ────────────────────────────
app.post('/api/replace', async (req, res) => {
  const { setting, context, url, style = 'neutral', humorType = 'balanced', answers, type, rejected, language = 'en' } = req.body;
  const isZh = language === 'zh';

  if (!setting || !context?.trim() || !type) {
    return res.status(400).json({ error: isZh ? '缺少必要参数。' : 'setting, context and type are required.' });
  }

  const styleMap = STYLE_MAP[isZh ? 'zh' : 'en'];
  const humorMap = HUMOR_MAP[isZh ? 'zh' : 'en'];

  let urlContext = '';
  if (url?.trim()) {
    const content = await tryFetchUrlContent(url.trim());
    if (content) urlContext = isZh ? `\n\n文档内容："${content}"` : `\n\nPresentation content: "${content}"`;
  }

  let answersContext = '';
  if (answers && typeof answers === 'object') {
    const lines = Object.entries(answers)
      .filter(([, v]) => v?.trim())
      .map(([q, a]) => `  • ${q}: ${a}`)
      .join('\n');
    if (lines) answersContext = isZh ? `\n\n受众信息：\n${lines}` : `\n\nAudience context:\n${lines}`;
  }

  const rejectedNote = rejected
    ? (isZh
        ? `\n\n用户不喜欢这条——不要重复或高度相似：\n"${rejected}"`
        : `\n\nThe user disliked this — do NOT repeat or closely resemble it:\n"${rejected}"`)
    : '';

  const settingLabel = isZh
    ? (setting === 'work' ? '职场场合' : '社交场合')
    : (setting === 'work' ? 'WORK — Professional' : 'LIFESTYLE — Casual social');

  const typeLabel = isZh ? (type === 'Ice Breaker' ? '开场白' : '段子') : type;

  const systemPrompt = isZh
    ? `你是一个幽默风趣的社交顾问。生成一条真正好笑、接地气的内容，完全针对中国文化背景。必须用中文输出，原汁原味，不要翻译腔。唯一限制：不涉及保护性特征的歧视内容。只返回有效JSON。`
    : `You are a sharp, witty social coach. Generate a single genuinely funny suggestion. Be ACTUALLY funny — specific, surprising, not generic. No content targeting protected characteristics or hate speech. Respond ONLY with valid JSON.`;

  const userPrompt = isZh
    ? `为这个场景重新生成1条全新的"${typeLabel}"。

场景：${settingLabel}
情况：${context.trim()}${answersContext}${urlContext}
语气：${styleMap[style] || styleMap.neutral}
幽默风格：${humorMap[humorType] || humorMap.balanced}${rejectedNote}

要求：内容新颖有趣，和之前不一样，多用中国文化元素和地道表达。

JSON格式：{"type": "${type}", "content": "..."}`
    : `Generate exactly 1 fresh "${type}" for this situation.

Setting: ${settingLabel}
Situation: ${context.trim()}${answersContext}${urlContext}
Tone: ${styleMap[style] || styleMap.neutral}
Humor Style: ${humorMap[humorType] || humorMap.balanced}${rejectedNote}

JSON format: {"type": "${type}", "content": "..."}`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid response format');

    const parsed = JSON.parse(match[0]);
    if (!parsed.content) throw new Error('Missing content');

    res.json({ suggestion: { type, content: parsed.content } });
  } catch (err) {
    console.error('[Replace Error]', err.message);
    res.status(500).json({ error: isZh ? '无法获取替换内容，请重试。' : 'Could not fetch replacement. Please try again.' });
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
