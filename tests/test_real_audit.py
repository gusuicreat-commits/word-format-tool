import unittest

from tests.run_real_papers import normalize_part


class AuditTests(unittest.TestCase):
    def test_equivalent_relationship_paths_compare_equal(self):
        prefix = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        suffix = '</Relationships>'
        a = (prefix + '<Relationship Id="r1" Type="image" Target="/media/image.jpg"/>' + suffix).encode()
        b = (prefix + '<Relationship Target="../media/image.jpg" Type="image" Id="r1"/>' + suffix).encode()
        self.assertEqual(normalize_part('word/_rels/document.xml.rels', a), normalize_part('word/_rels/document.xml.rels', b))

    def test_changed_relationship_target_is_not_hidden(self):
        a = b'<Relationships><Relationship Id="r1" Target="media/a.png"/></Relationships>'
        b = a.replace(b'a.png', b'b.png')
        self.assertNotEqual(normalize_part('word/_rels/document.xml.rels', a), normalize_part('word/_rels/document.xml.rels', b))

    def test_changed_footnote_text_is_not_hidden(self):
        a = b'<footnotes><note>Original</note></footnotes>'
        self.assertNotEqual(normalize_part('word/footnotes.xml', a), normalize_part('word/footnotes.xml', a.replace(b'Original', b'Changed')))

    def test_media_bytes_are_not_normalized(self):
        self.assertEqual(normalize_part('media/image.jpg', b'raw-image'), b'raw-image')
