import type { DynamicFieldSchema } from '@/lib/services/leaprs-service';
import { PORTAL_CHATBOT_GUIDE } from '@/lib/portal-chatbot-guide';

export interface ExtractedActivityDesign {
  isActivityDesign: boolean;
  explanation: string;
  aipCode: string | null;
  setting: 'internal' | 'external' | null;
  requestedBudget: string | null;
  description: string | null;
  dynamicFields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  uncertainFields: string[];
  summary: string;
}

export interface ActivityDesignFileInput {
  base64Data: string;
  mimeType: string;
  fileName: string;
}

export async function extractActivityDesignWithGemini(
  file: ActivityDesignFileInput,
  schema: {
    fixedFields: Array<{ name: string; label: string; type: string; isRequired: boolean }>;
    dynamicFields: DynamicFieldSchema[];
  }
): Promise<{ success: boolean; data?: ExtractedActivityDesign; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Gemini API is not configured.' };
  }

  const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

  const dynamicFieldsPrompt = schema.dynamicFields.map((f) => ({
    key: `field:${f.id}`,
    fallbackName: f.name,
    label: f.name,
    type: f.type,
    isRequired: f.isRequired,
    placeholder: f.placeholder,
    options: f.options,
  }));

  const systemInstruction = `You are the intelligent assistant for the Lifelong Education Advancement Program Requisition System (LEAPRS).
The user shared an image or document in the chat.

FIRST: Think and determine if this is an Activity Design, Training Proposal, Seminar Plan, or Requisition Document with enough meaningful details to prepare a LEAPRS request.

CASE A - NOT an activity design (or insufficient request information, screenshot of app, general photo, chart, diagram, or question):
- Set "isActivityDesign": false.
- In "explanation", provide a smart, direct, helpful 1-2 sentence response explaining what you see in the image or answering what is shown from a LEAPRS perspective. Use exact UI labels in **bold** if referring to LEAPRS features.
- Set "aipCode": null, "setting": null, "requestedBudget": null, "description": null, "dynamicFields": {}, "uncertainFields": [], "summary": "".

CASE B - IS an activity design / seminar proposal:
- Set "isActivityDesign": true.
- Extract requisition fields into the schema below.
- Look carefully for any AIP code or reference code printed in the document (e.g. "AIP: 3000-001-2-3-21-006-022" or "0000-000-0-0-00-000-000"). Extract the exact AIP code string if present; if not printed, set "aipCode" to null.
- For "requestedBudget", find the total proposed amount or budget requirement. Clean currency signs and return the numeric string.
- For "setting", determine if "internal" (in-house/on-campus) or "external" (offsite/external provider).
- For "description", extract the activity/seminar title or primary objective.
- For "dynamicFields", map extracted details to active fields using their "field:<id>" key.
- In "explanation", strictly output a single sentence stating the title: "I found an activity design for **[Title]**." Never ask for AIP codes, never ask follow-up questions, and never mention missing fields.

LEAPRS Guidelines for Grounding:
${PORTAL_CHATBOT_GUIDE}

Return ONLY valid JSON matching this structure:
{
  "isActivityDesign": boolean,
  "explanation": string,
  "aipCode": string | null,
  "setting": "internal" | "external" | null,
  "requestedBudget": string | null,
  "description": string | null,
  "dynamicFields": Record<string, unknown>,
  "fieldConfidence": Record<string, number>,
  "uncertainFields": string[],
  "summary": string
}`;

  const userPrompt = `Analyze this image (${file.fileName}).

Active Dynamic Fields in LEAPRS:
${JSON.stringify(dynamicFieldsPrompt, null, 2)}

Determine if this is an activity design and return strict JSON.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: file.mimeType || 'image/jpeg',
                    data: file.base64Data,
                  },
                },
                {
                  text: userPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini multimodal request failed:', response.status, errText);
      return { success: false, error: 'Gemini analysis failed.' };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const jsonText = payload.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!jsonText) {
      return { success: false, error: 'Gemini returned an empty response.' };
    }

    const parsed = JSON.parse(jsonText) as Partial<ExtractedActivityDesign>;

    const isActivityDesign = Boolean(parsed.isActivityDesign);

    const result: ExtractedActivityDesign = {
      isActivityDesign,
      explanation: parsed.explanation?.trim() || (isActivityDesign ? 'I found an activity design and can prepare a request.' : 'I reviewed the image.'),
      aipCode: parsed.aipCode?.trim() || null,
      setting: parsed.setting === 'external' ? 'external' : parsed.setting === 'internal' ? 'internal' : null,
      requestedBudget: parsed.requestedBudget ? String(parsed.requestedBudget).replace(/[^0-9.]/g, '') : null,
      description: parsed.description?.trim() || null,
      dynamicFields: (parsed.dynamicFields as Record<string, unknown>) || {},
      fieldConfidence: parsed.fieldConfidence || {},
      uncertainFields: Array.isArray(parsed.uncertainFields) ? parsed.uncertainFields : [],
      summary: parsed.summary || '',
    };

    return { success: true, data: result };
  } catch (error) {
    console.error('Failed to analyze image with Gemini:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to analyze image.',
    };
  }
}
