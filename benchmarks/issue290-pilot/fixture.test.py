import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('supplement',Path(__file__).with_name('fable-supplement.py'))
supp=importlib.util.module_from_spec(spec);spec.loader.exec_module(supp)

class LinkedFixtureTest(unittest.TestCase):
    def test_claude_launch_settings_exist_in_linked_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            episode,workspace,hooks=supp.linked_prepare(Path(directory),supp.WORKLOAD,'B',
                supp.pilot.PROTOCOL['models'][1],0)
            self.assertTrue((workspace/'hook-settings.json').is_file(),
                'Claude --settings must exist before any model launch')
            self.assertTrue((workspace/'.git').is_file(),'must use the linked checkout')
            self.assertTrue((workspace/'.pilot.json').is_file())

    def test_router_attribution_is_required_before_next_trial(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaises(RuntimeError):supp.pilot.require_router_attribution(root)
            (root/'router.txt').write_text('unrelated stdout')
            with self.assertRaises(RuntimeError):supp.pilot.require_router_attribution(root)
            (root/'router.txt').write_text('ROUTER WORKFLOW PLAN')
            supp.pilot.require_router_attribution(root)

if __name__=='__main__':unittest.main()
