import { registerLMStudioHandlers } from "./local_model_lmstudio_handler";
import { registerOllamaHandlers } from "./local_model_ollama_handler";

export function registerLocalModelHandlers() {
  registerOllamaHandlers();
  registerLMStudioHandlers();
}
