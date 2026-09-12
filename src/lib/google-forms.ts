type FormKind = 'participant' | 'supervisor';

type QuestionTemplate = {
  title: string;
  kind: 'rating' | 'paragraph';
  required: boolean;
};

type GoogleForm = {
  formId?: string;
  responderUri?: string;
  info?: { title?: string };
  items?: Array<{
    itemId?: string;
    title?: string;
    questionItem?: {
      question?: {
        questionId?: string;
        scaleQuestion?: { low?: number; high?: number };
        textQuestion?: { paragraph?: boolean };
      };
    };
  }>;
};

type GoogleFormResponse = {
  responseId?: string;
  answers?: Record<string, {
    textAnswers?: { answers?: Array<{ value?: string }> };
  }>;
};

type GeminiSummary = {
  overview: string;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
};

export type EvaluationSummary = {
  formTitle: string;
  responseCount: number;
  ratingQuestions: Array<{
    question: string;
    average: number;
    distribution: number[];
  }>;
  aiSummary: GeminiSummary | null;
  aiError?: string;
};

export type GeneratedGoogleForm = {
  formId: string;
  responderUrl: string;
};

const PARTICIPANT_QUESTIONS: QuestionTemplate[] = [
  { title: 'Overall satisfaction with the activity', kind: 'rating', required: true },
  { title: 'Relevance of the content to your work', kind: 'rating', required: true },
  { title: 'Effectiveness of the facilitator or resource person', kind: 'rating', required: true },
  { title: 'Organization and logistics', kind: 'rating', required: true },
  { title: 'What was most useful?', kind: 'paragraph', required: false },
  { title: 'What could be improved?', kind: 'paragraph', required: false },
  { title: 'Additional comments', kind: 'paragraph', required: false },
];

const SUPERVISOR_QUESTIONS: QuestionTemplate[] = [
  { title: "Relevance of the activity to the employee's role", kind: 'rating', required: true },
  { title: 'Improvement in knowledge or skills', kind: 'rating', required: true },
  { title: 'Application of learning in the workplace', kind: 'rating', required: true },
  { title: 'Overall value of the activity', kind: 'rating', required: true },
  { title: 'What positive changes have you observed?', kind: 'paragraph', required: false },
  { title: 'What follow-up support is recommended?', kind: 'paragraph', required: false },
  { title: 'Additional comments', kind: 'paragraph', required: false },
];

async function getGoogleAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth is not configured.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('Unable to authorize Google Forms.');
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error('Google did not return an access token.');
  return token.access_token;
}

async function googleJson<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Google Forms API request failed:', response.status, detail);
    if (response.status === 403) {
      throw new Error('Google Forms access was denied. Enable the Forms API and authorize the connected Google account.');
    }
    throw new Error('Google Forms could not complete the request.');
  }
  return response.json() as Promise<T>;
}

export async function createRequestEvaluationForm(input: {
  kind: FormKind;
  requestId: number;
  aipCode: string;
}): Promise<GeneratedGoogleForm> {
  const accessToken = await getGoogleAccessToken();
  const isParticipant = input.kind === 'participant';
  const label = isParticipant ? 'Participant Feedback' : 'Supervisor Evaluation';
  const questions = isParticipant ? PARTICIPANT_QUESTIONS : SUPERVISOR_QUESTIONS;
  const title = `${label} – ${input.aipCode} – Request #${input.requestId}`;

  const created = await googleJson<GoogleForm>('https://forms.googleapis.com/v1/forms?unpublished=true', accessToken, {
    method: 'POST',
    body: JSON.stringify({ info: { title, documentTitle: title } }),
  });
  if (!created.formId) throw new Error('Google Forms did not return a form ID.');

  await googleJson(`https://forms.googleapis.com/v1/forms/${created.formId}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateFormInfo: {
            info: {
              description: `LEAPRS ${label} for ${input.aipCode}, Request #${input.requestId}. Rate each item from 1 (lowest) to 5 (highest).`,
            },
            updateMask: 'description',
          },
        },
        ...questions.map((question, index) => ({
          createItem: {
            item: {
              title: question.title,
              questionItem: {
                question: {
                  required: question.required,
                  ...(question.kind === 'rating'
                    ? { scaleQuestion: { low: 1, high: 5, lowLabel: 'Lowest', highLabel: 'Highest' } }
                    : { textQuestion: { paragraph: true } }),
                },
              },
            },
            location: { index },
          },
        })),
      ],
    }),
  });

  await googleJson(`https://www.googleapis.com/drive/v3/files/${created.formId}/permissions?sendNotificationEmail=false`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
  });

  await googleJson(`https://forms.googleapis.com/v1/forms/${created.formId}:setPublishSettings`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } },
      updateMask: 'publishState',
    }),
  });

  const form = await googleJson<GoogleForm>(`https://forms.googleapis.com/v1/forms/${created.formId}`, accessToken);
  return {
    formId: created.formId,
    responderUrl: form.responderUri || `https://docs.google.com/forms/d/${created.formId}/viewform`,
  };
}

async function getAllResponses(formId: string, accessToken: string) {
  const responses: GoogleFormResponse[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://forms.googleapis.com/v1/forms/${formId}/responses`);
    url.searchParams.set('pageSize', '5000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await googleJson<{ responses?: GoogleFormResponse[]; nextPageToken?: string }>(url.toString(), accessToken);
    responses.push(...(page.responses || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return responses;
}

async function summarizeWithGemini(input: {
  formTitle: string;
  responseCount: number;
  ratings: EvaluationSummary['ratingQuestions'];
  comments: Array<{ question: string; responses: string[] }>;
}): Promise<GeminiSummary> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Gemini is not configured.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: `Summarize this evaluation in simple, neutral language for government staff. Base every statement only on the supplied data. Do not infer identities, quote personal information, or overstate findings from a small sample.\n\n${JSON.stringify(input)}`,
        }],
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            overview: { type: 'STRING' },
            strengths: { type: 'ARRAY', items: { type: 'STRING' } },
            improvements: { type: 'ARRAY', items: { type: 'STRING' } },
            recommendations: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['overview', 'strengths', 'improvements', 'recommendations'],
        },
      },
    }),
  });
  if (!response.ok) {
    console.error('Gemini summary request failed:', response.status, await response.text());
    throw new Error('Gemini could not generate the summary.');
  }
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty summary.');
  return JSON.parse(text) as GeminiSummary;
}

export async function getEvaluationSummary(formId: string): Promise<EvaluationSummary> {
  const accessToken = await getGoogleAccessToken();
  const [form, responses] = await Promise.all([
    googleJson<GoogleForm>(`https://forms.googleapis.com/v1/forms/${formId}`, accessToken),
    getAllResponses(formId, accessToken),
  ]);

  const ratingQuestions: EvaluationSummary['ratingQuestions'] = [];
  const comments: Array<{ question: string; responses: string[] }> = [];
  for (const item of form.items || []) {
    const question = item.questionItem?.question;
    const questionId = question?.questionId;
    if (!questionId || !item.title) continue;
    const values = responses.flatMap((response) =>
      response.answers?.[questionId]?.textAnswers?.answers
        ?.map((answer) => answer.value?.trim())
        .filter((value): value is string => Boolean(value)) || []
    );
    if (question.scaleQuestion) {
      const numericValues = values.map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);
      const distribution = [1, 2, 3, 4, 5].map((rating) => numericValues.filter((value) => value === rating).length);
      ratingQuestions.push({
        question: item.title,
        average: numericValues.length > 0
          ? Math.round((numericValues.reduce((total, value) => total + value, 0) / numericValues.length) * 10) / 10
          : 0,
        distribution,
      });
    } else if (question.textQuestion && values.length > 0) {
      comments.push({ question: item.title, responses: values.slice(0, 200).map((value) => value.slice(0, 500)) });
    }
  }

  let aiSummary: GeminiSummary | null = null;
  let aiError: string | undefined;
  if (responses.length > 0) {
    try {
      aiSummary = await summarizeWithGemini({
        formTitle: form.info?.title || 'Evaluation',
        responseCount: responses.length,
        ratings: ratingQuestions,
        comments,
      });
    } catch (error) {
      aiError = error instanceof Error ? error.message : 'AI summary is temporarily unavailable.';
    }
  }

  return {
    formTitle: form.info?.title || 'Evaluation Summary',
    responseCount: responses.length,
    ratingQuestions,
    aiSummary,
    aiError,
  };
}
