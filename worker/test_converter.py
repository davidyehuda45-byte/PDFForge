import csv
import os
import tempfile
import unittest
import zipfile

import pymupdf as fitz
from PIL import Image
import openpyxl

import converter


class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def path(self, name):
        return os.path.join(self.temp.name, name)

    def test_text_to_real_pdf(self):
        source, output = self.path("note.txt"), self.path("note.pdf")
        with open(source, "w", encoding="utf-8") as f:
            f.write("A real PDFForge conversion")
        warning = converter.convert({
            "source": source, "output": output, "source_name": "note.txt",
            "target": "pdf", "operation": "convert", "options": {},
        })
        self.assertEqual(warning, "")
        converter.validate_output(output, "pdf")
        doc = fitz.open(output)
        self.assertIn("A real PDFForge conversion", doc[0].get_text())
        doc.close()

    def test_image_round_trip(self):
        source, pdf, output = self.path("photo.png"), self.path("photo.pdf"), self.path("photo.webp")
        Image.new("RGB", (20, 12), (22, 100, 60)).save(source)
        base = {"source": source, "source_name": "photo.png", "operation": "convert", "options": {}}
        converter.convert({**base, "output": pdf, "target": "pdf"})
        converter.validate_output(pdf, "pdf")
        embedded = fitz.open(pdf)
        self.assertTrue(embedded[0].get_images())
        embedded.close()
        converter.convert({"source": pdf, "source_name": "photo.pdf", "output": output,
                           "target": "webp", "operation": "convert", "options": {"dpi": "72"}})
        converter.validate_output(output, "webp")
        with Image.open(output) as image:
            self.assertEqual(image.size, (20, 12))

    def test_csv_to_pdf_and_xlsx(self):
        source, pdf, xlsx = self.path("table.csv"), self.path("table.pdf"), self.path("table.xlsx")
        with open(source, "w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerows([["name", "total"], ["Ada", "42"], ["=1+1", "unsafe"]])
        base = {"source": source, "source_name": "table.csv", "operation": "convert", "options": {}}
        converter.convert({**base, "output": pdf, "target": "pdf"})
        document = fitz.open(pdf)
        self.assertIn("Ada", document[0].get_text())
        document.close()
        converter.convert({**base, "output": xlsx, "target": "xlsx"})
        workbook = converter.openpyxl.load_workbook(xlsx, data_only=True)
        self.assertEqual(workbook.active["A2"].value, "Ada")
        self.assertEqual(workbook.active["A3"].value, "=1+1")
        self.assertEqual(workbook.active["A3"].data_type, "s")
        workbook.close()

    def test_pdf_merge_and_page_extraction(self):
        sources = []
        for index, text in enumerate(("first", "second"), 1):
            path = self.path(f"{index}.pdf")
            doc = fitz.open()
            page = doc.new_page()
            page.insert_text((72, 72), text)
            doc.save(path)
            doc.close()
            sources.append(path)
        merged = self.path("merged.pdf")
        converter.convert({"source": sources[0], "merge_sources": sources[1:], "output": merged,
                           "source_name": "1.pdf", "target": "pdf", "operation": "merge", "options": {}})
        doc = fitz.open(merged)
        self.assertEqual(len(doc), 2)
        doc.close()
        subset = self.path("subset.pdf")
        converter.convert({"source": merged, "output": subset, "source_name": "merged.pdf",
                           "target": "pdf", "operation": "split", "page_range": "2", "options": {}})
        doc = fitz.open(subset)
        self.assertEqual(len(doc), 1)
        self.assertIn("second", doc[0].get_text())
        doc.close()

    def test_pdf_render_respects_total_pixel_limit_before_rendering(self):
        source = self.path("small-pages.pdf")
        document = fitz.open()
        document.new_page(width=10, height=10)
        document.new_page(width=10, height=10)
        document.save(source)
        document.close()
        document = fitz.open(source)
        previous_limit = converter.MAX_IMAGE_JOB_PIXELS
        converter.MAX_IMAGE_JOB_PIXELS = 150
        try:
            with self.assertRaisesRegex(ValueError, "total pixel limit"):
                converter.ensure_render_job_pixels(document, [0, 1], 72)
        finally:
            converter.MAX_IMAGE_JOB_PIXELS = previous_limit
            document.close()

    def test_output_validation_respects_configured_size_limit(self):
        source, output = self.path("note.txt"), self.path("note.pdf")
        with open(source, "w", encoding="utf-8") as f:
            f.write("Output size validation")
        converter.convert({
            "source": source, "output": output, "source_name": "note.txt",
            "target": "pdf", "operation": "convert", "options": {},
        })
        previous_limit = converter.MAX_OUTPUT_BYTES
        converter.MAX_OUTPUT_BYTES = 1
        try:
            with self.assertRaisesRegex(ValueError, "output size"):
                converter.validate_output(output, "pdf")
        finally:
            converter.MAX_OUTPUT_BYTES = previous_limit

    def test_images_can_be_merged_into_a_multipage_pdf(self):
        sources = []
        for index, color in enumerate(((200, 30, 20), (20, 60, 190)), 1):
            path = self.path(f"page-{index}.png")
            Image.new("RGB", (12, 8), color).save(path)
            sources.append(path)
        output = self.path("combined.pdf")
        converter.convert({
            "source": sources[0], "merge_sources": sources[1:], "output": output,
            "source_name": "page-1.png", "target": "pdf", "operation": "merge",
            "options": {"merge_images": "true"},
        })
        document = fitz.open(output)
        self.assertEqual(len(document), 2)
        document.close()

    def test_docx_output_is_a_readable_office_document(self):
        path = self.path("result.docx")
        converter.create_docx("Hello document", path)
        with zipfile.ZipFile(path) as office:
            self.assertIn("Hello document", office.read("word/document.xml").decode())

    def test_every_advertised_conversion_pair_produces_its_claimed_format(self):
        source_paths = {}

        def text_file(fmt, text):
            path = self.path("source." + fmt)
            with open(path, "w", encoding="utf-8") as stream:
                stream.write(text)
            source_paths[fmt] = path

        text_file("txt", "PDFForge capability matrix sample\nsecond row")
        text_file("md", "# Capability test\nSecond row")
        text_file("html", "<html><body><h1>Capability test</h1><p>Second row</p></body></html>")
        text_file("rtf", r"{\rtf1\ansi Capability test\par Second row}")
        text_file("csv", "name,value\nAda,42\n")
        text_file("tsv", "name\tvalue\nAda\t42\n")

        docx_path = self.path("source.docx")
        converter.create_docx("Capability test\nSecond row", docx_path)
        source_paths["docx"] = docx_path
        xlsx_path = self.path("source.xlsx")
        workbook = openpyxl.Workbook()
        workbook.active.append(["name", "value"])
        workbook.active.append(["Ada", "42"])
        workbook.save(xlsx_path)
        source_paths["xlsx"] = xlsx_path

        for fmt in ("odt", "odp"):
            path = self.path("source." + fmt)
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("mimetype", "application/vnd.oasis.opendocument.text")
                archive.writestr("content.xml", "<document><p>Capability test</p><p>Second row</p></document>")
            source_paths[fmt] = path
        pptx_path = self.path("source.pptx")
        with zipfile.ZipFile(pptx_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("ppt/presentation.xml", "<presentation/>")
            archive.writestr("ppt/slides/slide1.xml",
                             '<slide xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                             '<a:t>Capability test</a:t></slide>')
        source_paths["pptx"] = pptx_path
        epub_path = self.path("source.epub")
        with zipfile.ZipFile(epub_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("mimetype", "application/epub+zip")
            archive.writestr("chapter.xhtml", "<html><body>Capability test</body></html>")
        source_paths["epub"] = epub_path

        pdf_path = self.path("source.pdf")
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "Capability test\nSecond row")
        doc.save(pdf_path)
        doc.close()
        source_paths["pdf"] = pdf_path

        for fmt in ("jpg", "png", "webp", "gif", "bmp", "tiff"):
            path = self.path("source." + fmt)
            Image.new("RGB", (20, 12), (24, 80, 130)).save(path)
            source_paths[fmt] = path

        for index, capability in enumerate(converter.capabilities()):
            source = capability["from"]
            target = capability["to"]
            output = self.path("output-%03d.%s" % (index, target))
            result = converter.convert({
                "source": source_paths[source],
                "output": output,
                "source_name": "source." + source,
                "target": target,
                "operation": "convert",
                "options": {"dpi": "72"},
            })
            warning = result[0] if isinstance(result, tuple) else result
            self.assertIsInstance(warning, str)
            claimed = result[1] if isinstance(result, tuple) else target
            converter.validate_output(output, claimed)

    def test_registry_has_no_identity_or_unimplemented_pairs(self):
        pairs = {(cap["from"], cap["to"]) for cap in converter.capabilities()}
        self.assertEqual(len(pairs), len(converter.capabilities()))
        self.assertEqual({(source, target) for source, target in pairs if source == target},
                         {("pdf", "pdf")})
        self.assertIn(("png", "pdf"), pairs)
        self.assertIn(("jpg", "pdf"), pairs)
        self.assertIn(("html", "pdf"), pairs)
        self.assertIn(("pdf", "md"), pairs)
        self.assertIn(("pdf", "json"), pairs)
        self.assertIn(("pdf", "xml"), pairs)
        self.assertIn(("pdf", "pptx"), pairs)
        self.assertNotIn(("html", "png"), pairs)
        self.assertNotIn(("ods", "pdf"), pairs)
        self.assertNotIn(("doc", "pdf"), pairs)

    def test_pdf_text_conversion_honors_selected_pages(self):
        source, output = self.path("pages.pdf"), self.path("selected.txt")
        document = fitz.open()
        for text in ("page one", "page two", "page three"):
            page = document.new_page()
            page.insert_text((72, 72), text)
        document.save(source)
        document.close()
        converter.convert({
            "source": source, "output": output, "source_name": "pages.pdf",
            "target": "txt", "operation": "convert", "page_range": "2",
            "options": {},
        })
        with open(output, encoding="utf-8") as stream:
            result = stream.read()
        self.assertIn("page two", result)
        self.assertNotIn("page one", result)
        self.assertNotIn("page three", result)

    def test_markdown_html_renders_basic_markup_without_raw_html(self):
        rendered = converter.markdown_html(
            "# A title\n\n**Important** and *emphasis*\n\n<script>alert(1)</script>"
        )
        self.assertIn("<h1>A title</h1>", rendered)
        self.assertIn("<strong>Important</strong>", rendered)
        self.assertIn("<em>emphasis</em>", rendered)
        self.assertIn("&lt;script&gt;", rendered)

    def test_invalid_rtf_and_html_are_rejected_by_content(self):
        for fmt in ("rtf", "html"):
            source = self.path("invalid." + fmt)
            with open(source, "w", encoding="utf-8") as stream:
                stream.write("plain text is not " + fmt.upper())
            with self.assertRaises(ValueError):
                converter.read_source(source, fmt)


if __name__ == "__main__":
    unittest.main()
