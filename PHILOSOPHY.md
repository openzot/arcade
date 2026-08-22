# Why the shape is fixed

A factory is organised around repetition. An injection-moulding line can
switch between several sunglasses frames, but the frame being made is decided
before production starts — its tolerances and its production path are known.
The contents change all the time. The shape doesn't.

The arcade works the same way. Every run ends with the same kind of artefact:
three files of plain HTML, CSS and JavaScript, and one new row in the
catalogue. That shape was decided up front, and `scripts/check.sh` holds the
line on it. The order never changes either — the only thing that carries from
one run to the next is the catalogue, which the order says to read first, so
each new game has to steer around all the games that came before it. Everything
a player would actually notice — genre, mechanic, theme, art, sound — is up
for grabs. The shape is not.

It took running a few of these to understand why that matters. A factory
pointed at "turn product issues into features" sounds like the same idea, but
it isn't. The boundary moves with every issue: a billing change asks nothing
like an interface tweak, the agent has to rediscover the relevant system each
time, and almost none of the production path repeats. That isn't a factory,
it's a workshop — a different job arriving every morning. Workshops can do
good work. They just have no repeatable process to get better at.

A fixed shape does. When every run lands inside the same envelope, failures
can be compared, and a problem found today can become a rule for tomorrow.
The three-file split is one of those rules. Games here started as a single
HTML file, until it became obvious that rewriting a game loop shouldn't mean
re-emitting the whole stylesheet along with it. So the games became three
files, the check started enforcing it, and every shift since has followed the
same path — nobody has to remember the lesson, because the gate remembers it.

That's the whole idea. Fix the shape so the process repeats; a process that
repeats is one you can improve.
