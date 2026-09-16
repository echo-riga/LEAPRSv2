type QuestionTemplate = {
  title: string;
  kind: 'rating' | 'short';
  required: boolean;
};

type EvaluationSection = {
  title: string;
  description?: string;
  questions: QuestionTemplate[];
};

type FormItemTemplate = QuestionTemplate | {
  title: string;
  description?: string;
  pageBreak: true;
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
    pageBreakItem?: Record<string, never>;
  }>;
};

type GoogleFormResponse = {
  responseId?: string;
  answers?: Record<string, {
    textAnswers?: { answers?: Array<{ value?: string }> };
  }>;
};

type AiSummary = {
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
  aiSummary: AiSummary | null;
  aiError?: string;
};

export type GeneratedGoogleForm = {
  formId: string;
  responderUrl: string;
};

const EVALUATION_SECTIONS: EvaluationSection[] = [
  {
    title: 'Guest Speaker',
    questions: [
      { title: 'The speaker demonstrated strong knowledge and expertise on the topic', kind: 'rating', required: true },
      { title: 'The speaker presented concepts clearly and logically.', kind: 'rating', required: true },
      { title: "The speaker maintained the audience's attention and involvement.", kind: 'rating', required: true },
      { title: 'The speaker answered participant questions effectively and respectfully.', kind: 'rating', required: true },
      { title: 'The speaker used appropriate visual aids or materials to support the presentation.', kind: 'rating', required: true },
      { title: "The content presented was relevant to the seminar's theme and participants’ needs.", kind: 'rating', required: true },
      { title: 'The speaker provided practical examples or applications related to the topic.', kind: 'rating', required: true },
      { title: 'The speaker displayed professionalism in speech, appearance, and conduct.', kind: 'rating', required: true },
      { title: 'The speaker contributed positively to my learning and engagement in the seminar.', kind: 'rating', required: true },
    ],
  },
  {
    title: 'Learnings and Content',
    description: 'Please assess how the learning content supported your reflection, realignment, and renewal for personal and professional development.',
    questions: [
      { title: 'Relevance of topics discussed', kind: 'rating', required: true },
      { title: 'Overall learning gained', kind: 'rating', required: true },
    ],
  },
  {
    title: 'Overall Satisfaction',
    questions: [
      { title: 'Overall organization of the event', kind: 'rating', required: true },
      { title: 'Time management and flow', kind: 'rating', required: true },
    ],
  },
  {
    title: 'Comments and Suggestions',
    questions: [
      { title: 'What did you like most about the seminar?', kind: 'short', required: true },
      { title: 'What can be improved in future seminars?', kind: 'short', required: true },
    ],
  },
  {
    title: 'Skills or Training Areas',
    questions: [
      { title: 'What topics or areas of personal and professional growth would you like to see included in future seminars to support you in your role as an admin?', kind: 'short', required: true },
      { title: 'Name to appear in certificate (Firstname MI. Lastname)', kind: 'short', required: true },
    ],
  },
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
  requestId: number;
  aipCode: string;
}): Promise<GeneratedGoogleForm> {
  const accessToken = await getGoogleAccessToken();
  // Google Forms keeps this as the editable Section 1 title. Coordinators set
  // the actual seminar name with the Edit Form action after generation.
  const title = 'TITLE';

  const created = await googleJson<GoogleForm>('https://forms.googleapis.com/v1/forms?unpublished=true', accessToken, {
    method: 'POST',
    body: JSON.stringify({ info: { title, documentTitle: title } }),
  });
  if (!created.formId) throw new Error('Google Forms did not return a form ID.');

  // The form title and description are Section 1. Every evaluation group,
  // including Guest Speaker, must begin with its own page break.
  const formItems: FormItemTemplate[] = EVALUATION_SECTIONS.flatMap((section) => [
    { title: section.title, description: section.description, pageBreak: true as const },
    ...section.questions,
  ]);

  await googleJson(`https://forms.googleapis.com/v1/forms/${created.formId}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateFormInfo: {
            info: {
              description: `Thank you for participating in the seminar TITLE.\n\nYour insights and feedback are highly valuable to us, as they help ensure that our programs remain relevant, impactful, and aligned with the institution’s Five-Year Development Plan and internationalization goals.\n\nWe kindly invite you to take a few minutes to evaluate the seminar by rating its various aspects. Your responses will be treated with strict confidentiality and will be used solely for continuous improvement and future program enhancement.\n\nInstructions:\nFor each item, please rate your level of agreement or satisfaction using the scale below:\n\n5 – Strongly Agree / Excellent\n4 – Agree / Very Good\n3 – Neutral / Good\n2 – Disagree / Fair\n1 – Strongly Disagree / Poor\n\nWe appreciate your honest and constructive feedback!`,
            },
            updateMask: 'description',
          },
        },
        ...formItems.map((item, index) => ({
          createItem: 'pageBreak' in item
            ? {
                item: { title: item.title, description: item.description, pageBreakItem: {} },
                location: { index },
              }
            : {
                item: {
                  title: item.title,
                  questionItem: {
                    question: {
                      required: item.required,
                      ...(item.kind === 'rating'
                        ? { scaleQuestion: { low: 1, high: 5, lowLabel: 'Strongly Disagree / Poor', highLabel: 'Strongly Agree / Excellent' } }
                        : { textQuestion: { paragraph: false } }),
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

export async function isLegacyRequestEvaluationForm(formId: string) {
  try {
    const accessToken = await getGoogleAccessToken();
    const form = await googleJson<GoogleForm>(`https://forms.googleapis.com/v1/forms/${formId}`, accessToken);
    const title = form.info?.title?.trim() || '';
    const hasGuestSpeakerSection = form.items?.some((item) => item.pageBreakItem && item.title === 'Guest Speaker');
    return title.startsWith('Evaluation for ') || title.startsWith('Participant Feedback') || !hasGuestSpeakerSection;
  } catch (error) {
    // Keep the existing link available if Google is temporarily unreachable.
    console.error('Unable to check the generated evaluation form:', error);
    return false;
  }
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

async function summarizeWithGroq(input: {
  formTitle: string;
  responseCount: number;
  ratings: EvaluationSummary['ratingQuestions'];
  comments: Array<{ question: string; responses: string[] }>;
}): Promise<AiSummary> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq is not configured.');
  const model = process.env.GROQ_SUMMARY_MODEL || 'qwen/qwen3.8-27b';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      reasoning_format: 'hidden',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'user', content: `Identify written-response strengths, improvements, and recommended actions for government staff. Rating charts are already displayed separately: never repeat, summarize, mention, or infer a rating, score, average, count, or chart result. Base every item only on written comments. Do not infer identities, quote personal information, or overstate findings from a small sample. Return only JSON in this shape: {"strengths":["..."],"improvements":["..."],"recommendations":["..."]}. Use empty arrays when the written comments do not support a section.\n\n${JSON.stringify(input)}` },
      ],
    }),
  });
  if (!response.ok) {
    console.error('Groq summary request failed:', response.status);
    throw new Error('Groq could not generate the summary.');
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned an empty summary.');
  const summary = JSON.parse(text) as Partial<AiSummary>;
  if (!Array.isArray(summary.strengths) || !Array.isArray(summary.improvements) || !Array.isArray(summary.recommendations)) {
    throw new Error('Groq returned an invalid summary.');
  }
  return {
    strengths: summary.strengths.filter((item): item is string => typeof item === 'string'),
    improvements: summary.improvements.filter((item): item is string => typeof item === 'string'),
    recommendations: summary.recommendations.filter((item): item is string => typeof item === 'string'),
  };
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

  let aiSummary: AiSummary | null = null;
  let aiError: string | undefined;
  if (responses.length > 0) {
    try {
      aiSummary = await summarizeWithGroq({
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
