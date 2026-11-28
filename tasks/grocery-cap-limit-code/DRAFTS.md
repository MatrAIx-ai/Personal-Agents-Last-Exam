# Drafts

These notes are for Suraj to post if he wants to. This package does not post them.

## Progress note for @haolun-wu

The implementation is on `task-proposal/grocery-cap-limit-code` at `<HEAD_SHA>`. The proposal file is still blob `87f75800a3a8c8b9ed56720fa8b68566e4205603`.

The LifePack stand-in loads pinned Keelcard `e0471686b1e28403649a8971b9435c0dc88db0a7`, Mail 1.3.0, a task-local FreshCart subset and the web stub. The reference, both accepted approaches, the hinted replay and the no-reply branch score 20 of 20. Doing nothing scores 0. Each forbidden plan scores 0 of 20, including plans that had earned all 20 points before the full-pass gate. Reset restores the November 18 seed, including a rollout order created before the reset. History coverage is 79 distinct Eastern dates, from the household seed, the 19 November list edits and the proposal records.

Official model rollouts are still waiting on the roster and on infrastructure release #135, so I have not suggested `/submit-implementation`. The 14-day window from your approval note has not started. Harbor's Dockerfile is written and was not built.

## Note for @Breezelled on FreshCart #37

Hello @Breezelled. Grocery task #75 needs FreshCart to charge a Keelcard. Do you plan to adopt Keelcard's `channel.card.authorization` contract? The schema at the pinned Keelcard commit is https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/e0471686b1e28403649a8971b9435c0dc88db0a7/apps/keelcard/schemas/card-authorization-message.schema.json

The fields this task needs are the amount, the merchant id, an idempotency key shaped `freshcart:<account>:<order>:<attempt>`, and a way to read the decision back with `keelcard.authorizations.lookup`. Until FreshCart grows that, the task carries a small local subset that speaks the same contract. Happy to adjust the subset if your plan already covers this.
