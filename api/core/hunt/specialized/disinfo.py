"""Disinformation & fact-check layer.

The actual Google Fact Check Tools client lives in
``hunt.ingestion.tools.factcheck`` (the working-tool folder). This
package remains for future disinfo-specific modules (claim graph
deduplication, coordinated-bhaviour detection, etc.) and as a
stable import path for downstream code.
"""
