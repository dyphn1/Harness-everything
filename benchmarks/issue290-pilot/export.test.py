import importlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

exporter = importlib.import_module('export')


class SanitizerTest(unittest.TestCase):
    def secrets(self):
        return ['sk-'+'a'*24, 'ghp_'+'b'*36, 'github_pat_'+'c'*32,
                'xoxb-'+'d'*24, 'AKIA'+'E'*16,
                'Authorization: Bearer '+'f'*32,
                'Authorization: Basic '+'Z'*24,
                '-----BEGIN RSA '+'PRIVATE KEY-----',
                'api_key='+'g'*32, 'password='+'h'*20,
                json.dumps({'client_secret':'i'*32})]

    def test_positive_classes_fail_before_and_after_json_encoding(self):
        for value in self.secrets():
            for text in (value, json.dumps({'log':value})):
                with self.subTest(category=value[:8]), self.assertRaises(ValueError):
                    exporter.sanitize(text)

    def test_negative_examples_remain_publishable(self):
        for text in ['api_key=<REDACTED>', 'Authorization: Bearer <TOKEN>',
                     'password=${PASSWORD}', 'ghp_example', 'sk-short',
                     'public-key SHA256:abcdef', 'api_key = os.environ.get("KEY")']:
            exporter.validate_no_secrets(exporter.sanitize(text))

    def test_final_directory_scan_covers_metadata_and_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'inventory.json').write_text(json.dumps({'note': self.secrets()[0]}))
            with self.assertRaises(ValueError):
                exporter.scan_final([root])
            (root/'inventory.json').write_text('{}')
            (root/'stderr.log').write_text(self.secrets()[5])
            with self.assertRaises(ValueError):
                exporter.scan_final([root])

    def test_final_archive_scan_covers_contents_and_member_names(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'final.tar.gz'
            for name, body in [('metadata.json', self.secrets()[6]), (self.secrets()[1]+'.txt', '{}')]:
                with tarfile.open(target, 'w:gz') as archive:
                    data = body.encode()
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
                with self.assertRaises(ValueError):
                    exporter.scan_final([target])

    def test_private_reasoning_is_removed_structurally(self):
        value = {'content':[{'type':'thinking','thinking':'private content','signature':'opaque'}], 'safe':1}
        clean = exporter.strip_private_reasoning(value)
        self.assertNotIn('private content', json.dumps(clean))
        self.assertEqual(clean['safe'], 1)


if __name__ == '__main__':
    unittest.main()
