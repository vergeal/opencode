import { createSimpleContext } from "@opencode/ui/context"
import { createKnowledge } from "./model"

/**
 * One knowledge model for the shell: the navigation column lists libraries and files and the workspace shows
 * the overview or the preview, so a selection made in either place drives the other.
 */
export const { use: useKnowledge, provider: KnowledgeProvider } = createSimpleContext({
  name: "Knowledge",
  gate: false,
  init: () => createKnowledge(),
})
