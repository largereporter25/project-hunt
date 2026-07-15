"""Project HUNT — specialized intelligence modules.

  * Disinformation: claim graph + coordinated-bhaviour detection
    (see ``hunt.ingestion.tools.factcheck`` for the Fact Check client).
  * India corporate accountability: MyNeta/ADR, Indian Kanoon,
    eCourts, TAFCOP — see ``hunt.specialized.india``.

Every module exposes a ``ToolFunction`` (or a thin wrapper around one)
so the rest of the system treats them uniformly. They are deliberately
split into their own package so compliance reviews can scope them
separately.
"""
