# Writing lessons

Each `.yaml` file in this folder is one lesson. It is bundled into the app at
build time; `npm test` checks every lesson and fails if something is wrong
(for example, an answer that refers to a claim that isn't marked).

## A minimal lesson

```yaml
id: my-lesson            # lowercase-with-dashes; used in the URL (#/lesson/my-lesson)
title: My lesson
description: One or two sentences for the lesson list.
claimMode: marked        # or: highlight

steps:
  - instructions: Map the argument.
    passage: |
      {{c1|We should adopt the policy}}, because {{c2|it saves money}}.
    answer:
      conclusion: c1
      relations:
        - { type: support, from: [c2], to: c1 }
```

## Marking claims

Wrap each claim in the passage as `{{id|text}}`. Ids start with a letter and
must be unique within the lesson. Single line breaks become spaces; a blank
line starts a new paragraph.

You can mark sentences that are *not* part of the argument (background,
repetition, asides). Leave them out of the answer; students who add them get a
note, not a penalty.

## Claim modes

- `marked`: claims are numbered and clickable. Students choose which ones
  belong in the argument.
- `highlight`: the passage looks like plain text. Students select the claims
  themselves. A highlight counts as a claim when most of it falls inside the
  marked text and it covers at least a third of it, so mark claims tightly.

## Answers

- `conclusion`: the main conclusion.
- `relations`: each one is `{ type, from, to }`.
  - `type`: `support`, `objection`, or `rebuttal` (a rebuttal is an objection
    aimed at an objection; the two words are interchangeable).
  - `from`: one premise, or several premises that work **together** (a
    linked argument). Premises that each give an independent reason
    (convergent) go in separate relations.
- `alternatives`: other answers that also earn full credit. Students are graded
  against whichever answer suits their map best.
- `mistakes`: feedback for specific wrong links you expect, e.g.
  ```yaml
  mistakes:
    - relation: { type: support, from: [c3], to: c1 }
      message: Claim 3 supports claim 2, not the conclusion directly.
  ```

## Multi-step lessons

Each step adds text to the passage, and its `answer` is the **whole** map
after that step (not just what changed). Claims from earlier steps can be
used in later answers. When students move on, they can carry their own map
forward or start from the model answer.

## Model wording

Students may reword claims on their map. `modelWording` gives your preferred
statement of a claim. Students see it next to their own wording when they
check their work, and it is used in the model-answer map. Wording is not
scored.

```yaml
modelWording:
  c1: The city should adopt the congestion-pricing policy.
```

## Building an answer key by drawing it

Open a lesson with `?author` at the end of the URL (e.g.
`#/lesson/my-lesson?author`), build the map, and choose **Save, load, and
reset → Copy answer YAML**. Paste the result into the step.
