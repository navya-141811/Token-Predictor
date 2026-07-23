import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

const encoder = new Tiktoken(o200kBase);

window.ChatGPTTokenCounterTokenizer = {
  encoding: "o200k_base",
  count(text) {
    return encoder.encode(String(text || ""), "all").length;
  }
};
