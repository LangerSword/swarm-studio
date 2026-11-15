"""The agent's asset library and References tools (decision 0025 d, issue #609): search answers with credit and
licence and asks nobody; import, pick and adding a reference write or download, so they go to Hermes's approval gate
first, and a cron job with nobody to answer is refused before the studio is touched."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import commands  # noqa: E402

ROW = {"id": "pixel_art/icons/kite.png", "subject": "glide kite", "category": "icons", "pack": "pixel_art", "own": False,
       "credit": "assetrizz by mojomast", "license": "full grant from the author", "url": "https://github.com/mojomast/assetrizz"}
OWN = {"id": "my_pack/props/lamp.png", "subject": "lamp", "category": "props", "pack": "my_pack", "own": True,
       "credit": "Ana", "license": "CC BY 4.0", "url": ""}


class AgentLibrary(unittest.TestCase):
    def test_the_schema_offers_the_four_actions_and_their_fields(self):
        props = commands.TOOL_SCHEMA["parameters"]["properties"]
        for action in ("library_search", "library_import", "library_pick", "reference_add"):
            self.assertIn(action, props["action"]["enum"])
        for field in ("category", "pack", "path", "name", "credit", "license", "url", "slot", "asset", "what", "project"):
            self.assertIn(field, props, field)
        self.assertIn("ask the person first", commands.TOOL_SCHEMA["description"])

    def test_writing_and_downloading_go_to_the_approval_gate_each_its_own_always(self):
        asks = ({"action": "library_import", "path": "C:/art/pack.zip", "name": "Mine", "credit": "Ana"},
                {"action": "library_pick", "build": "1", "slot": "item-kite", "asset": ROW["id"]},
                {"action": "reference_add", "project": "Cedar Cafe", "url": "https://example.com"},
                {"action": "reference_add", "project": "Cedar Cafe", "path": "C:/brief.pdf"})
        got = [commands.approval_hook(tool_name="swarm_studio", args=a) for a in asks]
        self.assertTrue(all(g and g["action"] == "approve" for g in got))
        self.assertEqual([g["rule_key"] for g in got], ["swarm-studio:library:import", "swarm-studio:library:pick", "swarm-studio:reference:add", "swarm-studio:reference:add"])
        self.assertIn("credited to 'Ana'", got[0]["message"])
        self.assertIn("downloaded", got[1]["message"])
        self.assertIn("opened to read its look", got[2]["message"])
        self.assertIn("brief.pdf", got[3]["message"])

    def test_search_asks_nobody_and_names_credit_and_licence(self):
        self.assertIsNone(commands.approval_hook(tool_name="swarm_studio", args={"action": "library_search", "text": "kite"}))
        with mock.patch.object(commands, "_api", return_value={"results": [ROW, OWN]}) as api:
            out = commands.tool({"action": "library_search", "text": "kite lamp", "category": "icons"})
        path = api.call_args[0][0]
        self.assertTrue(path.startswith("/api/library?") and "q=kite+lamp" in path and "category=icons" in path, path)
        self.assertIn("pixel_art/icons/kite.png", out)
        self.assertIn("assetrizz by mojomast, full grant from the author <https://github.com/mojomast/assetrizz>", out)
        self.assertIn("my_pack/props/lamp.png", out)
        self.assertIn("Ana, CC BY 4.0", out)
        self.assertIn("yours", out)

    def test_import_needs_a_credit_and_says_what_it_brought(self):
        with mock.patch.object(commands, "_api", side_effect=AssertionError("called")):
            self.assertIn("whose art", commands.tool({"action": "library_import", "path": "C:/art", "name": "Mine"}))
        with mock.patch.object(commands, "_api", return_value={"id": "mine", "name": "Mine", "count": 12, "credit": "Ana", "license": "CC0"}) as api:
            out = commands.tool({"action": "library_import", "path": "C:/art", "name": "Mine", "credit": "Ana", "license": "CC0"})
        self.assertEqual(api.call_args[0][0], "/api/library/import")
        self.assertEqual(api.call_args[0][1]["credit"], "Ana")
        self.assertIn("12 pictures", out)
        self.assertIn("credit: Ana, CC0", out)

    def test_pick_sets_the_slot_and_names_the_credit(self):
        run = {"id": "2026-11-15T00-00-00-000Z", "title": "Lantern Run"}

        def api(path, body=None, **_):
            if path.endswith("/art/picks"):
                self.assertEqual(body, {"slot": "item-kite", "asset": ROW["id"], "what": "the glide kite"})
                return {"picks": [body], "note": "used the next time this build paints its art"}
            return {"results": [ROW]}
        with mock.patch.object(commands, "_pick_run", return_value=run), mock.patch.object(commands, "_api", side_effect=api):
            out = commands.tool({"action": "library_pick", "build": "1", "slot": "item-kite", "asset": ROW["id"], "what": "the glide kite"})
        self.assertIn("Lantern Run", out)
        self.assertIn("Credit: assetrizz by mojomast", out)

    def test_a_reference_link_goes_to_the_named_project(self):
        projects = {"projects": [{"id": "p1", "name": "Alpha Tea"}, {"id": "s-cedar", "name": "Cedar Cafe"}]}
        calls = []

        def api(path, body=None, **_):
            calls.append((path, body))
            return projects if path == "/api/projects" else {"ref": {"url": "https://example.com/"}, "refs": []}
        with mock.patch.object(commands, "_api", side_effect=api):
            out = commands.tool({"action": "reference_add", "project": "cedar", "url": "https://example.com", "text": "the calm"})
        self.assertEqual(calls[-1], ("/api/projects/s-cedar/refs/link", {"url": "https://example.com", "use": "the calm"}))
        self.assertIn("Cedar Cafe", out)
        with mock.patch.object(commands, "_api", side_effect=api):
            self.assertIn("no project called", commands.tool({"action": "reference_add", "project": "nope", "url": "https://a.b"}))

    def test_a_reference_file_is_sent_as_itself(self):
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "brief.pdf")
            with open(f, "wb") as fh:
                fh.write(b"%PDF-1.4 hello")
            with mock.patch.object(commands, "_api", return_value={"projects": [{"id": "s-cedar", "name": "Cedar Cafe"}]}), \
                    mock.patch.object(commands, "_upload", return_value={"ref": {"name": "brief.pdf"}}) as up:
                out = commands.tool({"action": "reference_add", "project": "Cedar Cafe", "path": f})
            path, raw = up.call_args[0]
            self.assertTrue(path.startswith("/api/projects/s-cedar/refs?") and "name=brief.pdf" in path and "source=upload" in path, path)
            self.assertEqual(raw, b"%PDF-1.4 hello")
            self.assertIn("Added brief.pdf", out)
            with mock.patch.object(commands, "_api", return_value={"projects": [{"id": "s-cedar", "name": "Cedar Cafe"}]}):
                self.assertIn("No such file", commands.tool({"action": "reference_add", "project": "Cedar Cafe", "path": os.path.join(d, "gone.pdf")}))

    def test_cron_refuses_the_writing_ones_without_touching_the_studio(self):
        ctx = mock.Mock()
        ctx.current_cron_execution.return_value = object()
        with mock.patch.object(commands, "CTX", ctx), mock.patch.object(commands, "_api", side_effect=AssertionError("called")), \
                mock.patch.object(commands, "_upload", side_effect=AssertionError("called")):
            for args in ({"action": "library_import", "path": "x", "credit": "Ana"}, {"action": "library_pick", "slot": "item-a", "asset": "a/b.png"},
                         {"action": "reference_add", "project": "x", "url": "https://a.b"}):
                self.assertIn("nobody to give it", commands.tool(args))


if __name__ == "__main__":
    unittest.main()
