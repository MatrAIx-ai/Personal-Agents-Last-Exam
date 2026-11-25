"""Regression checks for the model-facing channel, run matrix and strict PALE thresholds."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from harbor.models.agent.context import AgentContext
from packet_agent import PacketAgent, chat_session, public_tools
from study import FAMILIES, outcome, schedule, summarize


class StudyTests(unittest.TestCase):
    def test_fresh_run_matrix_and_strict_cutoffs(self):
        rows = list(schedule())
        self.assertEqual(len({r["id"] for r in rows}), 24)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertTrue(all(r["status"] == "incomplete" for r in summarize(rows, root)["models"].values()))
            for row in rows:
                path = root / "jobs" / row["id"] / "trial"
                path.mkdir(parents=True)
                hinted = row["variant"] == "hinted"
                score = 1 if hinted else {"GPT": 0.50, "Claude": 0.49, "Gemini": 0.1}[row["family"]]
                passed = hinted
                if row["id"] == "validation-gemini-1":
                    score, passed = 1, True
                result = {"trial_name": "test", "reward_valid": True, "step_results": [],
                          "verifier_result": {"rewards": {"rubric_score": score, "full_pass": int(passed)}}}
                (path / "result.json").write_text(json.dumps(result))
            status = summarize(rows, root)["models"]
            self.assertEqual([status[f]["status"] for f in FAMILIES], ["thresholds_missed","qualifies","thresholds_missed"])
            path = root / "jobs" / "validation-claude-hinted" / "trial" / "result.json"
            result = json.loads(path.read_text())
            result["verifier_result"]["rewards"]["rubric_score"] = .99
            path.write_text(json.dumps(result))
            self.assertEqual(summarize(rows, root)["models"]["Claude"]["status"], "thresholds_missed")
            result["reward_valid"] = False
            path.write_text(json.dumps(result))
            self.assertEqual(outcome(path.parent.parent)["status"], "infrastructure_or_review")

    def test_public_text_on_tool_turns_and_final_answer(self):
        tools = public_tools([{"name":"mail.get","description":"Read","inputSchema":{"type":"object"}}])
        calls = [({"role":"assistant","content":"Checking now.","tool_calls":[
                  {"id":"1","function":{"name":"mail__get","arguments":'{"id":"m"}'}}]}, {}),
                 ({"role":"assistant","content":"The packet is ready."}, {})]
        complete = AsyncMock(side_effect=calls)
        packet = AsyncMock(return_value={"status":"ok"})
        messages, trace = [], []
        status = asyncio.run(chat_session(messages, tools, complete, packet, trace.append, 2))
        self.assertEqual(status, "finished")
        self.assertEqual([call.args[0] for call in packet.await_args_list], ["say","call","say"])
        self.assertEqual(messages[1]["role"], "tool")
        self.assertEqual(trace[-1]["content"], "The packet is ready.")

    def test_invalid_tool_request_returns_error_to_agent(self):
        msg = {"role":"assistant","tool_calls":[{"id":"1","function":{"name":"unavailable","arguments":"{}"}}]}
        packet, log = AsyncMock(), []
        status = asyncio.run(chat_session([], [], AsyncMock(return_value=(msg,{})), packet, log.append, 1))
        self.assertEqual(status,"turn_limit")
        packet.assert_not_awaited()
        self.assertEqual(json.loads(log[-1]["content"])["status"],"invalid_arguments")

    def test_native_agent_preserves_only_the_observed_dialogue_for_next_session(self):
        class Environment:
            async def exec(self, command, user):
                assert user == "node"
                if command == "packet status":
                    value = {"session":"test"}
                elif command == "packet tools":
                    value = []
                else:
                    assert command.startswith("packet say ")
                    value = {"delivered":True}
                return SimpleNamespace(return_code=0, stdout=json.dumps(value))
        msg = Mock()
        msg.model_dump.return_value = {"role":"assistant","content":"Ready."}
        usage = Mock()
        usage.model_dump.return_value = {"prompt_tokens":25,"completion_tokens":3}
        result = SimpleNamespace(choices=[SimpleNamespace(message=msg)],usage=usage,model="local-test")
        with tempfile.TemporaryDirectory() as temp:
            with patch("litellm.acompletion", new=AsyncMock(return_value=result)) as provider, patch("litellm.completion_cost",return_value=0.0):
                profile = AgentContext()
                for instruction in ("Morning request.","Meeting reply arrived."):
                    agent = PacketAgent(logs_dir=Path(temp)/"agent", model_name="openai/local-fixture", max_turns=2)
                    asyncio.run(agent.run(instruction, Environment(), profile))
                prior = provider.await_args.kwargs["messages"]
                self.assertTrue(any(m.get("content")=="Morning request." for m in prior))
                self.assertEqual(profile.n_output_tokens,6)
                self.assertEqual(profile.n_input_tokens,50)


if __name__ == "__main__":
    unittest.main()
