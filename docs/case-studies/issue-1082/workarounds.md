# Workarounds for "PDF too large" Error in Claude Code CLI

This document provides detailed workarounds for the "PDF too large" error in Claude Code CLI.

## Table of Contents

1. [Preventive Measures](#preventive-measures)
2. [Text Extraction Methods](#text-extraction-methods)
3. [PDF Splitting Techniques](#pdf-splitting-techniques)
4. [Recovery After Error](#recovery-after-error)
5. [Claude Code Configuration](#claude-code-configuration)

---

## Preventive Measures

### 1. Pre-flight Size Check

Always check PDF size before attempting to read:

```bash
#!/bin/bash
# check-pdf-size.sh

PDF_FILE="$1"

if [ ! -f "$PDF_FILE" ]; then
    echo "Error: File not found: $PDF_FILE"
    exit 1
fi

# Get file size in bytes
FILE_SIZE=$(stat -c%s "$PDF_FILE" 2>/dev/null || stat -f%z "$PDF_FILE")
FILE_SIZE_MB=$((FILE_SIZE / 1024 / 1024))

# Get page count using pdfinfo if available
if command -v pdfinfo &> /dev/null; then
    PAGE_COUNT=$(pdfinfo "$PDF_FILE" 2>/dev/null | grep "Pages:" | awk '{print $2}')
else
    PAGE_COUNT="unknown"
fi

echo "PDF File: $PDF_FILE"
echo "Size: ${FILE_SIZE_MB}MB"
echo "Pages: $PAGE_COUNT"

# Warnings
if [ "$FILE_SIZE_MB" -gt 4 ]; then
    echo "WARNING: File size exceeds 4MB - may cause 'PDF too large' error"
    echo "Recommendation: Extract text first using pdftotext"
fi

if [ "$PAGE_COUNT" != "unknown" ] && [ "$PAGE_COUNT" -gt 50 ]; then
    echo "WARNING: Page count exceeds 50 - may cause 'PDF too large' error"
    echo "Recommendation: Split PDF into smaller chunks"
fi
```

### 2. Known Limits

Based on error reports and testing, the approximate limits are:

| Metric      | Safe Limit | May Work      | Likely to Fail |
| ----------- | ---------- | ------------- | -------------- |
| File Size   | < 3MB      | 3-10MB        | > 10MB         |
| Page Count  | < 30 pages | 30-75 pages   | > 75 pages     |
| Token Count | < 20,000   | 20,000-25,000 | > 25,000       |

---

## Text Extraction Methods

### Method 1: pdftotext (Recommended)

The fastest and most reliable method:

```bash
# Install pdftotext (part of poppler-utils)
# Ubuntu/Debian:
sudo apt-get install poppler-utils

# macOS:
brew install poppler

# Extract text from PDF
pdftotext input.pdf output.txt

# Extract with layout preservation
pdftotext -layout input.pdf output.txt

# Extract specific pages (1-10)
pdftotext -f 1 -l 10 input.pdf output.txt
```

### Method 2: PyMuPDF (Python)

For more control over extraction:

```python
#!/usr/bin/env python3
# extract_pdf_text.py

import fitz  # PyMuPDF
import sys

def extract_text(pdf_path, output_path=None):
    """Extract text from PDF using PyMuPDF."""
    doc = fitz.open(pdf_path)

    text = []
    for page_num, page in enumerate(doc, 1):
        page_text = page.get_text()
        text.append(f"\n--- Page {page_num} ---\n")
        text.append(page_text)

    full_text = "\n".join(text)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(full_text)
        print(f"Text extracted to: {output_path}")
    else:
        print(full_text)

    return full_text

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_pdf_text.py <input.pdf> [output.txt]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    extract_text(pdf_path, output_path)
```

### Method 3: pdf2image + OCR (for scanned PDFs)

```python
#!/usr/bin/env python3
# ocr_pdf.py

from pdf2image import convert_from_path
import pytesseract
import sys

def ocr_pdf(pdf_path, output_path):
    """OCR a scanned PDF."""
    # Convert PDF to images
    images = convert_from_path(pdf_path, dpi=300)

    text = []
    for i, image in enumerate(images, 1):
        print(f"Processing page {i}/{len(images)}...")
        page_text = pytesseract.image_to_string(image)
        text.append(f"\n--- Page {i} ---\n")
        text.append(page_text)

    full_text = "\n".join(text)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(full_text)

    print(f"OCR complete: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python ocr_pdf.py <input.pdf> <output.txt>")
        sys.exit(1)

    ocr_pdf(sys.argv[1], sys.argv[2])
```

---

## PDF Splitting Techniques

### Method 1: pypdf (Python)

```python
#!/usr/bin/env python3
# split_pdf.py

from pypdf import PdfReader, PdfWriter
from pathlib import Path
import sys

def split_pdf(input_path, pages_per_chunk=25, output_dir=None):
    """Split a PDF into smaller chunks."""
    input_path = Path(input_path)
    output_dir = Path(output_dir) if output_dir else input_path.parent

    reader = PdfReader(input_path)
    total_pages = len(reader.pages)

    print(f"Total pages: {total_pages}")
    print(f"Pages per chunk: {pages_per_chunk}")

    chunks = []
    for start in range(0, total_pages, pages_per_chunk):
        writer = PdfWriter()
        end = min(start + pages_per_chunk, total_pages)
        chunk_num = start // pages_per_chunk + 1

        for page_num in range(start, end):
            writer.add_page(reader.pages[page_num])

        output_name = f"{input_path.stem}_chunk{chunk_num:02d}.pdf"
        output_path = output_dir / output_name

        with open(output_path, 'wb') as output_file:
            writer.write(output_file)

        chunks.append(str(output_path))
        print(f"Created: {output_name} (pages {start+1}-{end})")

    return chunks

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python split_pdf.py <input.pdf> [pages_per_chunk] [output_dir]")
        sys.exit(1)

    input_path = sys.argv[1]
    pages_per_chunk = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    output_dir = sys.argv[3] if len(sys.argv) > 3 else None

    split_pdf(input_path, pages_per_chunk, output_dir)
```

### Method 2: pdftk (Command Line)

```bash
# Install pdftk
# Ubuntu/Debian:
sudo apt-get install pdftk-java

# Split into individual pages
pdftk input.pdf burst output page_%03d.pdf

# Extract specific pages
pdftk input.pdf cat 1-25 output part1.pdf
pdftk input.pdf cat 26-50 output part2.pdf

# Split every N pages (using bash loop)
#!/bin/bash
PAGES_PER_CHUNK=25
TOTAL_PAGES=$(pdftk input.pdf dump_data | grep NumberOfPages | awk '{print $2}')

for ((start=1; start<=TOTAL_PAGES; start+=PAGES_PER_CHUNK)); do
    end=$((start + PAGES_PER_CHUNK - 1))
    if [ $end -gt $TOTAL_PAGES ]; then
        end=$TOTAL_PAGES
    fi
    chunk=$((start / PAGES_PER_CHUNK + 1))
    pdftk input.pdf cat ${start}-${end} output "chunk_${chunk}.pdf"
done
```

### Method 3: qpdf (Fast and Efficient)

```bash
# Install qpdf
# Ubuntu/Debian:
sudo apt-get install qpdf

# Split specific pages
qpdf input.pdf --pages . 1-25 -- output_part1.pdf
qpdf input.pdf --pages . 26-50 -- output_part2.pdf
```

---

## Recovery After Error

### If You're in Interactive Mode

1. **Use `/rewind` command** to go back before the failed read:

   ```
   /rewind
   ```

2. **Double-press ESC** as suggested (though this often doesn't work)

3. **Start a new session** if the REPL is stuck in error loop

### If Using Automation (like solve.mjs)

1. **Implement retry logic** with alternative approach:

```javascript
async function safeReadPdf(pdfPath) {
  // Check file size first
  const stats = await fs.stat(pdfPath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB > 4) {
    console.log(`PDF too large (${sizeMB.toFixed(1)}MB), extracting text...`);
    const txtPath = pdfPath.replace('.pdf', '.txt');
    await exec(`pdftotext "${pdfPath}" "${txtPath}"`);
    return { type: 'text', path: txtPath };
  }

  return { type: 'pdf', path: pdfPath };
}
```

2. **Add defensive prompts** to system instructions

---

## Claude Code Configuration

### CLAUDE.md Configuration

Add to your project's `.claude/CLAUDE.md` or `CLAUDE.md`:

````markdown
## PDF Processing Guidelines

### IMPORTANT: Handling PDF Files

To avoid the "PDF too large" error that crashes sessions:

1. **NEVER** use the Read tool directly on PDF files larger than 3MB
2. **NEVER** use the Read tool on PDFs with more than 50 pages
3. **ALWAYS** check PDF size and page count first:
   ```bash
   ls -la file.pdf
   pdfinfo file.pdf | grep Pages
   ```
````

4. **ALWAYS** extract text from large PDFs before processing:

   ```bash
   pdftotext large_document.pdf large_document.txt
   ```

5. **For structured extraction**, use PyMuPDF:
   ```python
   import fitz
   doc = fitz.open("document.pdf")
   for page in doc:
       text = page.get_text()
   ```

### Recommended Thresholds

| File Size | Action               |
| --------- | -------------------- |
| < 3MB     | Can try direct Read  |
| 3-10MB    | Extract text first   |
| > 10MB    | Split + extract text |

| Page Count  | Action              |
| ----------- | ------------------- |
| < 30 pages  | Can try direct Read |
| 30-75 pages | Extract text first  |
| > 75 pages  | Split into chunks   |

### If Error Occurs

If you see "PDF too large" error:

1. Use `/rewind` to go back
2. Extract text using pdftotext
3. Process the text file instead

````

### Environment Setup Script

```bash
#!/bin/bash
# setup-pdf-tools.sh
# Run this to set up PDF processing tools

echo "Installing PDF processing tools..."

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    sudo apt-get update
    sudo apt-get install -y poppler-utils qpdf pdftk-java
elif [[ "$OSTYPE" == "darwin"* ]]; then
    brew install poppler qpdf pdftk-java
fi

# Install Python packages
pip install pypdf PyMuPDF

echo "PDF tools installed successfully!"
echo ""
echo "Available commands:"
echo "  pdftotext - Extract text from PDF"
echo "  pdfinfo   - Get PDF information"
echo "  qpdf      - Split/merge PDFs"
echo "  pdftk     - PDF toolkit"
````

---

## Quick Reference

### Safe Workflow for Large PDFs

```bash
# 1. Check the PDF
pdfinfo large_document.pdf

# 2. If > 50 pages or > 4MB, extract text
pdftotext large_document.pdf large_document.txt

# 3. Or split into chunks
python split_pdf.py large_document.pdf 25

# 4. Process the text/chunks instead of original PDF
```

### One-liner for Safety

```bash
# Automatically extract if too large
[ $(stat -c%s doc.pdf) -gt 4000000 ] && pdftotext doc.pdf doc.txt && echo "Extracted to doc.txt" || echo "Safe to read directly"
```

---

## Related Resources

- [poppler-utils documentation](https://poppler.freedesktop.org/)
- [PyMuPDF documentation](https://pymupdf.readthedocs.io/)
- [pypdf documentation](https://pypdf.readthedocs.io/)
- [Claude Code GitHub Issues](https://github.com/anthropics/claude-code/issues)
