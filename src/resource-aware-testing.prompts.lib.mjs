import { promptText } from './prompt-text.lib.mjs';
/** Shared development preferences; explicit user requirements still take priority. */
export const RESOURCE_AWARE_SOLVER_IDENTITY = promptText('prompt.system.templates.resource-aware-testing-prompts.RESOURCE_AWARE_SOLVER_IDENTITY.text1', {}, { locale: 'en' });

export const getResourceAwareTestingSubPrompt = () => promptText('prompt.system.templates.resource-aware-testing-prompts.getResourceAwareTestingSubPrompt.text2');
