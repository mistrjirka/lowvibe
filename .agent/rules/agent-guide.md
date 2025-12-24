---
trigger: always_on
---

Here’s a “RAG prompt checklist” you can pretty much reuse for OpenAI models (gpt-5.1, reasoning models, etc.).


## 1. Separate **role**, **context**, and **question**

**Good practice**

* Use:

  * **System** message → behavior + global rules.
  * **User** message → the *actual question* and the retrieved context.
* Make the structure obvious, e.g.:

  ```text
  You are [role].

  # TASK
  ...

  # CONTEXT
  <CONTEXT>
  ...
  </CONTEXT>

  # QUESTION
  ...
  ```

**Why**

Structured, labeled sections make it easier for the model to parse what’s instructions vs data; OpenAI’s own prompt-engineering docs and other vendors call out structure and delimiters as key quality levers. ([platform.openai.com][1])

---

## 2. Use **delimiters/tags** for retrieved chunks

**Good practice**

* Wrap RAG context in clear tags:

  ```text
  # RETRIEVED DOCUMENTS
  <DOC id="1" title="...">
  ...
  </DOC>

  <DOC id="2" title="...">
  ...
  </DOC>
  ```

* Refer to them explicitly in instructions:

  > “Answer using ONLY information in `<DOC>` sections.”

**Why**

Research and multiple guides show delimiters (`"""`, backticks, XML tags) help models identify where specific info lives and reduce confusion between instructions and content. ([Scribd][2])

---

## 3. Explicit **grounding instructions**

**Good practice**

In the system/user prompt, say something like:

> * Use **only** the information in the retrieved documents to answer.
> * If the answer is not in the documents, say you **cannot find it** instead of using outside knowledge.

And repeat this once near the end of the prompt (recency effect).

**Why**

OpenAI’s “Optimizing LLM Accuracy” guidance emphasizes RAG as a way to ground answers and reduce hallucinations, and that prompts must clearly tell the model to stick to provided context. ([platform.openai.com][3])

---

## 4. Tell the model what to do when **information is missing or conflicting**

**Good practice**

Add a small policy block:

```text
If the documents don’t contain enough information:
- Clearly say what is missing.
- If you must assume something, list it in an "Assumptions" section.
- Never present assumptions as facts.
```

For extraction / form-filling:

```text
If a field cannot be found or confidently inferred, return "".
```

**Why**

RAG doesn’t magically guarantee completeness; prompt-level policies for uncertainty are a recurring best practice in RAG and hallucination-mitigation papers and blogs. ([ACL Anthology][4])

---

## 5. Be **very explicit** about output format

**Good practice**

* For prose: specify “markdown only”, headings, bullet style, *no preamble*.

* For data: use **JSON / structured outputs** with a schema and instructions like:

  ```text
  Return a single JSON object matching this schema...
  Do not include comments or extra keys.
  ```

* With OpenAI, prefer `response_format: { type: "json_schema", json_schema: {...} }` or tools/structured outputs instead of “plain JSON in text” when possible. ([platform.openai.com][5])

**Why**

Prompt-engineering docs stress clearly specifying output format; structured outputs make RAG pipelines more robust and easier to parse.

---

## 6. Ask for **citations / provenance**

**Good practice**

* Give a simple citation format:

  ```text
  When you state a fact, cite the document IDs like this:
  - "Our average response time is 30 minutes [DOC 2]"
  - If multiple docs support it: [DOC 1, DOC 3]
  ```

* Encourage minimal but consistent citation usage (e.g., once per paragraph or claim).

**Why**

RAG is about grounding; having the model surface which chunk supports which claim is widely recommended in RAG guides and blog posts focused on evaluation and trust. ([Google Cloud][6])

---

## 7. Tell the model how to **prioritize and filter context**

**Good practice**

Include explicit guidance like:

```text
- Prefer more recent documents over older ones when they conflict.
- Prefer RFP context over generic knowledge in past proposals.
- Ignore documents that are clearly unrelated to the question.
- When multiple documents disagree, note the disagreement instead of picking one at random.
```

**Why**

RAG evaluations show that retrieval often returns partially relevant or noisy docs; prompts that teach the model to **filter** and **prioritize** improve answer quality without changing retrieval parameters. ([orkes.io][7])

---

## 8. Keep instructions **simple and concise**

**Good practice**

* Avoid long, fussy meta-instructions.
* Prefer a short list of clear rules over a wall of prose.
* For OpenAI’s newer models (including reasoning models), follow their guidance: simple, direct instructions; avoid forcing full chain-of-thought in user-facing answers. ([platform.openai.com][1])

Example pattern:

```text
You are [role].
Your goals:
1. ...
2. ...
Rules:
- ...
- ...
Output format:
- ...
```

**Why**

OpenAI’s prompt guide stresses brevity + clarity; complex, contradictory instructions often reduce accuracy.

---

## 9. Use **few-shot examples** when the task is stable

**Good practice**

When you have a recurring query type (e.g. “answer RFP questions with citations” or “fill JSON for policies”), include 1–2 small examples in the prompt:

```text
Example:

[CONTEXT]
...
[/CONTEXT]

[QUESTION]
...

[ANSWER]
...
[/ANSWER]
```

Make examples short and realistic.

**Why**

Few-shot prompting is a standard technique to steer style and structure; this holds in RAG too, as long as examples are clearly separated from “live” context using delimiters. ([platform.openai.com][1])

---

## 10. Make the **task type explicit**: QA vs summary vs extraction vs rewrite

**Good practice**

* Don’t just say “here are docs, answer the question”.
* Say explicitly:

  * “Summarize the key points relevant to the question…”
  * “Extract a structured answer in JSON…”
  * “Rewrite the answer in customer-facing language…”

**Why**

RAG is often used for multiple task types over the same index; prompt engineering guides (including OpenAI’s and third-party RAG blogs) emphasize being explicit about task type to avoid generic, unfocused answers. ([platform.openai.com][3])

---

## 11. Tune **length and level of detail** in the prompt

**Good practice**

Add constraints like:

```text
- Keep the answer under 300 words.
- Focus only on information that directly answers the question; do not restate entire documents.
- Prefer bullet points over long paragraphs.
```

For long contexts, also remind:

```text
Do not quote large sections of the documents verbatim unless strictly necessary.
```

**Why**

RAG often pulls long passages; without length/coverage instructions, models may regurgitate context instead of synthesizing it. This is a common failure mode highlighted in RAG optimization blogs. ([Medium][8])

---

## 12. Evaluate & iterate with **real queries**

Not exactly a prompt *pattern*, but critical:

* Collect real user queries + gold answers.
* Test different prompt templates (e.g. with/without tags, different grounding wording).
* Measure:

  * factual accuracy,
  * citation correctness,
  * helpfulness.

OpenAI’s “Optimizing LLM Accuracy” and several RAG best-practice guides emphasize **evaluation-driven** iteration, not just tweaking prompts by feel. ([platform.openai.com][3])