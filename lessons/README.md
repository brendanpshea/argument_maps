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
- `mistakes`: feedback for specific wrong links you expect. Students never
  see the model answer, so write these as hints (a question that points them
  back to the text), not as the correct answer. For example:
  ```yaml
  mistakes:
    - relation: { type: support, from: [c3], to: c1 }
      message: Does (3) bear on the conclusion directly, or on another premise?
  ```

## Accepting more than one map

Arguments are often open to more than one reasonable reading. Mark each
judgment call where it occurs, rather than writing out whole alternative maps:

```yaml
equivalent:
  - [c1, c5]        # c5 restates c1, so either can stand in for the other

steps:
  - answer:
      conclusion: c1
      relations:
        - { type: support, from: [c2, c3], to: c1, grouping: either }  # linked or convergent
        - { type: objection, from: [c6], to: [c1, c2] }                 # either target is fine
        - { type: support, from: [c7], to: c1, optional: true }         # fine to include or leave out
```

| Annotation | Accepts |
|---|---|
| `grouping: either` | The premises linked, all independent, or any mix. |
| `to: [a, b]` | A link to any one of the listed claims. |
| `optional: true` | The link with or without it. If present, it must be right; it earns no extra points. |
| `equivalent` (lesson level) | Any claim in a set in place of any other, everywhere: as conclusion, premise, or target. A student who adds both gets a "repeats a claim" note. |

The annotations combine freely, so two judgment calls are two annotations,
not four whole maps.

For genuinely different readings of the whole argument, `alternatives` lists
other complete answers. The student is graded against whichever fits their
map best, and the hints come from that answer.

```yaml
    alternatives:
      - conclusion: c1
        relations: [...]
```

`npm test` grades every map your annotations accept (each grouping, each
target, optional links in and out) and fails if any of them scores below
100%.

## Multi-step lessons

Each step adds text to the passage, and its `answer` is the **whole** map
after that step (not just what changed). Claims from earlier steps can be
used in later answers. A student unlocks the next step only by getting the
current one fully right, and their map carries forward.

So every reading you accept in one step must still be accepted in the next.
Copy the annotated relation (e.g. with `grouping: either`) into each later
step's answer, along with any `alternatives`. `npm test` checks this: it takes
every map accepted at step N, adds the new material from step N+1, and fails
if step N+1 would mark it wrong.

## Students never see the answer

There is no "show answer" button. Feedback names only claims the student
already has on their map, and points at where to look again rather than
saying what the right link is. The test suite checks this for every lesson.

The answer keys are still bundled into the page, so a determined student
could dig them out of the browser's developer tools. That's fine for
practice; for high-stakes assessment you would need a server.

## Rewording claims

`rewording` controls how students may restate claims on their map:

| Setting | What students do | Scored? |
|---|---|---|
| `free` (default) | Type their own wording | No: shown next to your `modelWording` after checking |
| `choose` | Pick from wordings you write in `wordingChoices` | Yes, 1 point per claim in the answer |
| `none` | Keep the passage wording | n/a |

Whatever students type or pick, grading of the map itself always uses the
passage text the claim came from, never the wording.

### `free`: model wording

`modelWording` gives your preferred statement of a claim. Students see it
next to their own wording when they check their work, and it is used in the
model-answer map.

```yaml
modelWording:
  c1: The city should adopt the congestion-pricing policy.
```

### `choose`: wording choices

For each claim, give the best wording and two or three that are plausible
but flawed. Good flaws: leaves a pronoun unresolved, too strong, too weak,
too broad, changes the subject, drops the key point. `why` is shown when a
student picks that option. Choices are shuffled; students also see the
passage wording ("As written"), which earns no wording point.

```yaml
rewording: choose
wordingChoices:
  c1:
    best: Colleges should require their athletes to take drug tests.
    others:
      - text: Colleges should drug-test all of their students.
        why: Too broad. The author is talking only about athletes.
```

Claims without `wordingChoices` can't be reworded and aren't scored on
wording. The `best` wording is used in the model-answer map.

## Claim bank: unstated premises

`bank` lists claims that are not in the passage. Include the unstated
premises the argument needs, plus a few decoys it doesn't. Students add them
from a "Claim bank" panel (shown in random order) and use them like any other
claim. Use bank ids in answers exactly like passage claim ids.

```yaml
bank:
  - id: b1
    text: Colleges should prevent athletes from gaining unfair advantages.
  - id: b2            # decoy
    text: Most college athletes use performance-enhancing drugs.
  - id: b3
    text: A claim that is only offered from step 2 onward.
    step: 2
```

If a student leaves out a needed bank claim, feedback says how many unstated
claims are missing without naming them. Decoys on the map get a no-points
note, or your `mistakes` message if you wrote one.

## Building an answer key by drawing it

Open a lesson with `?author` at the end of the URL (e.g.
`#/lesson/my-lesson?author`), build the map, and choose **Save, load, and
reset → Copy answer YAML**. Paste the result into the step. Author mode also
shows a **Show model answer** button and lets you jump to any step.
