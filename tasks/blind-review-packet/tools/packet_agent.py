"""Harbor chat adapter for the blind packet's five business tools and user channel."""
import json
import shlex
from pathlib import Path

from harbor.agents.base import BaseAgent


SYSTEM = (
    "You are Ren's personal assistant. Use the provided App functions for workspace access. "
    "Function names with double underscores denote App operations, for example notes__get. "
    "All of your ordinary assistant text is delivered to Ren, including the final message. "
    "Use ask_ren to request clarification. Return a final response when the current session is done."
)


def public_tools(definitions):
    tools = [
        {"type": "function", "function": {
            "name": d["name"].replace(".", "__"), "description": d["description"], "parameters": d["inputSchema"],
        }} for d in definitions
    ]
    tools.append({"type": "function", "function": {
        "name": "ask_ren", "description": "Ask Ren a question. A reply may be unavailable.",
        "parameters": {"type": "object", "properties": {"text": {"type": "string"}},
                       "required": ["text"], "additionalProperties": False},
    }})
    return tools


async def chat_session(messages, tools, complete, packet, log, max_turns):
    allowed = {t["function"]["name"] for t in tools}
    for _ in range(max_turns):
        message, accounting = await complete(messages, tools)
        content = message.get("content")
        if isinstance(content, list):
            content = "\n".join(b.get("text", "") for b in content if b.get("type") in {"text", "output_text"})
        log({"role": "assistant", "content": content, "tool_calls": message.get("tool_calls") or [], **accounting})
        if content and content.strip():
            await packet("say", content)
        messages.append(message)
        calls = message.get("tool_calls") or []
        if not calls:
            return "finished"
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"]["arguments"])
                if not isinstance(args, dict) or name not in allowed:
                    raise ValueError("Select an available tool and supply a JSON object")
                if name == "ask_ren":
                    if set(args) != {"text"} or not isinstance(args["text"], str) or not args["text"].strip():
                        raise ValueError("ask_ren expects a text field")
                    result = await packet("ask", args["text"])
                else:
                    result = await packet("call", name.replace("__", "."), json.dumps(args, ensure_ascii=False))
            except (ValueError, TypeError) as error:
                result = {"status": "invalid_arguments", "message": str(error)}
            item = {"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, ensure_ascii=False)}
            messages.append(item)
            log(item)
    return "turn_limit"


class PacketAgent(BaseAgent):
    @staticmethod
    def name():
        return "blind-packet-chat"

    def version(self):
        return "0.1.0"

    def __init__(self, logs_dir, model_name=None, trial_paths=None, max_turns=24, max_output_tokens=2048,
                 completion_options=None, **kwargs):
        super().__init__(logs_dir=logs_dir, model_name=model_name, **kwargs)
        self.max_turns = int(max_turns)
        self.max_output_tokens = int(max_output_tokens)
        self.completion_options = completion_options or {}
        allowed = {"reasoning_effort", "temperature", "seed"}
        if set(self.completion_options) - allowed or min(self.max_turns, self.max_output_tokens) <= 0:
            raise ValueError("Invalid frozen completion settings")
        root = trial_paths.trial_dir if trial_paths else Path(logs_dir).parent
        self.history = Path(root) / "packet-dialogue.json"

    async def setup(self, environment):
        pass

    async def run(self, instruction, environment, context):
        from litellm import acompletion, completion_cost

        async def packet(*parts):
            result = await environment.exec(command=shlex.join(["packet", *parts]), user="node")
            if result.return_code != 0:
                raise RuntimeError("Packet interface failed: " + str(result.stderr or result.stdout)[:300])
            return json.loads(result.stdout)

        status = await packet("status")
        tools = public_tools(await packet("tools"))
        messages = (json.loads(self.history.read_text()) if self.history.exists()
                    else [{"role": "system", "content": SYSTEM}])
        messages.append({"role": "user", "content": instruction})
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        trace = self.logs_dir / "packet-provider.jsonl"

        def log(item):
            with trace.open("a", encoding="utf-8") as f:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")

        async def complete(history, functions):
            response = await acompletion(model=self.model_name, messages=history, tools=functions,
                                         max_tokens=self.max_output_tokens, num_retries=0, **self.completion_options)
            raw = response.choices[0].message
            message = raw.model_dump(exclude_none=True)
            message.setdefault("role", "assistant")
            usage = response.usage.model_dump() if response.usage else {}
            context.n_input_tokens = (context.n_input_tokens or 0) + usage.get("prompt_tokens", 0)
            context.n_output_tokens = (context.n_output_tokens or 0) + usage.get("completion_tokens", 0)
            try:
                price = completion_cost(completion_response=response)
            except Exception:
                price = None
            if price is not None:
                context.cost_usd = (context.cost_usd or 0.0) + price
            return message, {"usage": usage, "cost_usd": price, "provider_model": response.model}

        log({"session": status["session"], "role": "user", "content": instruction, "model": self.model_name,
             "tools": tools, "completion_options": self.completion_options,
             "max_output_tokens": self.max_output_tokens, "max_turns": self.max_turns})
        outcome = await chat_session(messages, tools, complete, packet, log, self.max_turns)
        log({"session": status["session"], "outcome": outcome})
        temp = self.history.with_suffix(".tmp")
        temp.write_text(json.dumps(messages, ensure_ascii=False))
        temp.replace(self.history)
