import { test } from "node:test";
import assert from "node:assert/strict";
import { clientMessages, type LhMessage } from "../src/core/native-messages.ts";

const assistant = {
	id: "a1",
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "plan the quiz", thinkingSignature: "opaque-provider-payload" },
		{ type: "text", text: "Here is the idea." },
		{ type: "toolCall", id: "c1", name: "quiz", arguments: { question: "Q?" } },
	],
	stopReason: "toolUse",
	timestamp: 1,
} as unknown as LhMessage;

const user = { id: "u1", role: "user", content: "hi", timestamp: 0 } as unknown as LhMessage;

test("clientMessages drops thinking signatures and keeps everything else", () => {
	const [, out] = clientMessages([user, assistant]) as [LhMessage, Extract<LhMessage, { role: "assistant" }>];
	assert.deepEqual(out.content[0], { type: "thinking", thinking: "plan the quiz" });
	assert.deepEqual(out.content.slice(1), (assistant as Extract<LhMessage, { role: "assistant" }>).content.slice(1));
	assert.equal(out.id, "a1");
	assert.equal(out.stopReason, "toolUse");
});

test("clientMessages never mutates the record and passes untouched messages through", () => {
	const record = [user, assistant];
	const out = clientMessages(record);
	assert.equal(out[0], user);
	assert.equal(
		(assistant as Extract<LhMessage, { role: "assistant" }>).content[0]!.type === "thinking" &&
			(assistant as { content: Array<{ thinkingSignature?: string }> }).content[0]!.thinkingSignature,
		"opaque-provider-payload",
	);
	const unsigned = { ...assistant, content: [{ type: "text", text: "plain" }] } as unknown as LhMessage;
	assert.equal(clientMessages([unsigned])[0], unsigned);
});
