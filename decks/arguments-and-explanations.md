# Arguments, Explanations, and Inference

Mapping reasoning: premises, conclusions, objections, and the difference
between deductive and inductive arguments.

---

## What is an argument?

An **argument** gives reasons (**premises**) for believing a claim (the **conclusion**).

```argmap
C*: Modern zoos should be phased out
P: Large animals such as elephants suffer in captivity
P -> C
```

Note: Point out the direction of the arrow: from the reason to what it supports. Ask students for the premise indicator in the passage ("because", "since").

---

## Chains of reasoning

A claim can be a conclusion *and* a premise: an **intermediate conclusion**.

```argmap
C*: Modern zoos should be phased out
P1: Large animals such as elephants suffer in captivity
P2: Elephants in zoos pace and sway, behaviors almost never seen in the wild
P1 -> C
P2 -> P1  @2
```

Note: Click once to add the evidence for the intermediate conclusion.

---

## Linked vs. convergent premises

- **Convergent:** each premise is a reason on its own.
- **Linked:** the premises only work together.

```argmap
C*: Modern zoos should be phased out
P1: Large animals suffer in captivity
P2: Zoos justify themselves mainly by appeal to conservation
P3: Most species kept in zoos are not endangered
P1 -> C
P2 + P3 -> C  @2
```

Note: P2 alone doesn't support C, and neither does P3. Together: the main justification fails. Ask: "If you deleted P2, would P3 still be a reason?"

---

## Objections and rebuttals

```argmap
C*: Modern zoos should be phased out
P: Large animals suffer in captivity
O: Zoos inspire children to care about wildlife   @2
R: Documentaries and sanctuaries inspire children just as well   @3
P -> C
O -x C
R -x O
```

A rebuttal is an objection to an objection. <!-- .element: class="fragment" data-fragment-index="3" -->

---

## Try it

Map the full zoo argument yourself, step by step:

[Should zoos be phased out? →](./#/lesson/zoos)

---

## Deductive vs. inductive

| | Claims that the premises… | Good ones are… | Bad ones are… |
|---|---|---|---|
| **Deductive** | *guarantee* the conclusion | valid | invalid |
| **Inductive** | make the conclusion *likely* | strong | weak |

Clue words: *must*, *necessarily*, *it follows that* (deductive) vs. *probably*, *likely*, *suggests* (inductive).

---

## Deductive and valid

```argmap
C*: The butler is the thief
P1: Whoever stole the jewels had to open the safe with its key
P2: Only the butler had a key
P1 + P2 -> C  [deductive, valid]
```

If both premises are true, the conclusion **must** be true.

---

## Deductive but invalid

```argmap
C*: The butler is the thief
P1: If the butler were the thief, he would have been nervous at dinner
P2: He was nervous at dinner
P1 + P2 -> C  [deductive, invalid]
```

**Affirming the consequent:** the premises could be true and the conclusion false.

Note: Ask for other reasons someone might be nervous at dinner.

---

## Inductive: strong vs. weak

```argmap
C*: The butler is the thief
P1: His fingerprints were on the jewel cases inside the safe
P2: In mystery novels, the butler is often the culprit
P1 -> C  [inductive, strong]
P2 -> C  [inductive, weak]  @2
```

---

## The whole case

The full map from the practice lesson, with every link evaluated:

```argmap lesson=butler
```

[Try it: Who stole the jewels? →](./#/lesson/butler)

---

## Generalizations

A sample speaks for everyone only if it's **representative**. The argument assumes that, so we write it down.

```argmap
C*: About 62% of the school's students support a later start
S: 62% of the 400 students who answered the survey support it
R (unstated): The students who answered are representative of the whole school
S + R -> C
O: The survey was posted only in the honors students' lounge  @2
O -x R
Q: The survey was also emailed to every student  @3
Q -x O
```

Note: Click through: the objection challenges the unstated premise (not the conclusion), and the rebuttal answers it. "Challenged" and "answered" come from the map's structure; they don't say who is right.

---

## Strong reasoning, challenged premise

```argmap lesson=survey
```

- If the premises were true, the conclusion would be likely: the reasoning is **strong**.
- The trouble is a **premise**, and the objection already says so.
- So criticism goes after the premises: an argument is only as good as both its reasoning *and* its premises.

[Try it: Is the survey representative? →](./#/lesson/survey)

---

## Arguments vs. explanations

An **explanation** doesn't try to convince you *that* something is true; it tells you **why** it is.

- The **explanandum** is what is being explained.
- The **explanans** is what explains it.

```argmap
X*: The streets are wet
E1: It rained last night
E2: The street sweepers came through this morning  @2
E1 => X
E2 => X
```

---

## A fuller explanation

```argmap lesson=autumn-leaves
```

[Try it: Why do maple leaves change color? →](./#/lesson/autumn-leaves)

---

## Summary

- Arguments give **reasons for** a conclusion; explanations say **why** something is so.
- Premises can be **linked** or **convergent**; claims can form **chains**.
- **Objections** count against a claim; **rebuttals** answer objections.
- **Generalizations** assume the sample is representative; write that premise down, since it's where objections usually land.
- **Deductive** arguments are valid or invalid; **inductive** ones are strong or weak.
