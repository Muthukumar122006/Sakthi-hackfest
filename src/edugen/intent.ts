export type EducationalIntent =
  | 'colouring_worksheet'
  | 'flashcard'
  | 'textbook_illustration'
  | 'science_diagram'
  | 'educational_poster'
  | 'general_illustration'

export const intentOptions: { value: EducationalIntent; label: string }[] = [
  { value: 'colouring_worksheet', label: 'Colouring sheet' },
  { value: 'flashcard', label: 'Study card' },
  { value: 'textbook_illustration', label: 'Book picture' },
  { value: 'science_diagram', label: 'Science diagram' },
  { value: 'educational_poster', label: 'Poster' },
  { value: 'general_illustration', label: 'Other picture' },
]

export const creativeCategories = [
  'fun',
  'motivational',
  'bold',
  'educational',
  'minimal',
  'inspirational',
  'cute',
  'professional',
  'creative',
  'custom',
] as const

export type CreativeCategory = typeof creativeCategories[number]

export const categoryLabels: Record<CreativeCategory, string> = {
  fun: 'Fun',
  motivational: 'Motivational',
  bold: 'Bold',
  educational: 'Educational',
  minimal: 'Minimal',
  inspirational: 'Inspirational',
  cute: 'Cute',
  professional: 'Professional',
  creative: 'Creative',
  custom: 'Custom',
}

export const categorySuggestions: Record<CreativeCategory, string[]> = {
  fun: ['Playful animals', 'Cute characters', 'Funny everyday scene', 'Colouring illustration'],
  motivational: ['Growth mindset', 'Reaching a goal', 'Positive encouragement', 'Personal achievement'],
  bold: ['High contrast', 'Strong geometric shapes', 'Energetic composition'],
  educational: ['Clear learning picture', 'Simple concept diagram', 'Age-friendly visual'],
  minimal: ['Few simple shapes', 'Clean layout', 'Lots of open space'],
  inspirational: ['Hopeful scene', 'Kind action', 'A moment of discovery'],
  cute: ['Friendly character', 'Soft rounded shapes', 'Warm expression'],
  professional: ['Clean presentation graphic', 'Simple editorial picture', 'Consistent layout'],
  creative: ['Unusual point of view', 'Imaginative scene', 'Unexpected colour choices'],
  custom: ['My own idea'],
}

export function classifyIntent(text: string): EducationalIntent {
  const prompt = text.toLowerCase()
  if (/colour|color|outline|colouring|coloring|worksheet/.test(prompt)) return 'colouring_worksheet'
  if (/flash.?card|study card|memory card|vocabulary card/.test(prompt)) return 'flashcard'
  if (/diagram|labeled|labelled|flowchart|circuit/.test(prompt)) return 'science_diagram'
  if (/poster|classroom display|notice board/.test(prompt)) return 'educational_poster'
  if (/textbook|lesson|chapter|book illustration/.test(prompt)) return 'textbook_illustration'
  return 'general_illustration'
}

export function recommendQuality(input: {
  prompt: string
  category: CreativeCategory
  intent: EducationalIntent
  targetAudience: string
}): { tier: 'studio-pro' | 'precision-lite' | 'draft-rapid'; explanation: string } {
  const prompt = input.prompt.toLowerCase()
  const detailed = /highly detailed|fine detail|intricate|photoreal|realistic texture|many small/.test(prompt)
  const simple = /colouring|coloring|outline|simple icon|few shapes|draft|rough concept/.test(prompt)
  const needsDetail = detailed
    || input.intent === 'science_diagram'
    || input.intent === 'educational_poster'
    || input.category === 'professional'
    || input.category === 'bold'

  if (simple && input.targetAudience.startsWith('Early childhood')) {
    return { tier: 'draft-rapid', explanation: 'Your prompt asks for a simple image for young children, so a basic option may be enough.' }
  }
  if (needsDetail) {
    return { tier: 'studio-pro', explanation: 'Your prompt asks for a detailed or clearly structured image, so the highest available option may help.' }
  }
  if (simple) {
    return { tier: 'draft-rapid', explanation: 'Your prompt describes a simple image, so the lower-cost option is a good fit.' }
  }
  if (input.category === 'minimal' || input.category === 'cute' || input.category === 'fun') {
    return { tier: 'draft-rapid', explanation: 'This style can work well with a simple image setting.' }
  }
  return { tier: 'precision-lite', explanation: 'This is a balanced starting choice for your image.' }
}

export function suggestedTier(intent: EducationalIntent): 'studio-pro' | 'precision-lite' | 'draft-rapid' {
  if (intent === 'colouring_worksheet') return 'draft-rapid'
  if (intent === 'educational_poster' || intent === 'science_diagram') return 'studio-pro'
  return 'precision-lite'
}
