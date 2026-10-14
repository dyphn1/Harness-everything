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

if __name__=='__main__':unittest.main()
