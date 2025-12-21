# PDF to Markdown Conversion Tools Research

> **Research Date**: November 2025
> **Context**: Issue #655 - PDF Processing Failure Case Study
> **Purpose**: Evaluate tools for converting PDF documents to Markdown format

## Executive Summary

This document provides a comprehensive overview of PDF-to-Markdown conversion tools available in 2025, focusing on open-source solutions that can help process large PDF files that exceed Claude's context window limits.

## Top Open Source PDF to Markdown Tools

### 1. Marker ⭐ Recommended for Complex Documents

**Repository**: https://github.com/datalab-to/marker

**Description**: Marker converts documents to markdown, JSON, chunks, and HTML quickly and accurately.

**Key Features**:
- Supports PDF, image, PPTX, DOCX, XLSX, HTML, EPUB files
- Works with all languages
- Formats tables, forms, equations, inline math, links, references, and code blocks
- Benchmarks favorably compared to cloud services (Llamaparse, Mathpix)
- Fast processing speed
- Feature-rich output

**Best For**:
- Batch conversion
- Complex documents with tables and formulas
- Multilingual scenarios
- Production environments requiring high accuracy

**Considerations**:
- Check licensing restrictions for your use case

---

### 2. MinerU ⭐ Recommended for Academic Papers

**Repository**: https://github.com/opendatalab/MinerU

**Description**: A PDF to MD converter tailored for scientific documents, academic papers, and journals.

**Key Features**:
- Converts PDFs to machine-readable formats (markdown, JSON)
- OCR supports 109 languages
- Multiple output formats: multimodal and NLP Markdown, JSON sorted by reading order
- Designed for parsing citations, math formulas, and complex academic structures
- Built with academia in mind

**Best For**:
- Scientific documents
- Academic papers and journals
- Documents with complex citations and formulas
- Research workflows

**Considerations**:
- Specialized for academic content
- May be overkill for simple documents

---

### 3. MarkItDown (Microsoft)

**Description**: Microsoft's open-source Python utility for converting diverse file formats into Markdown.

**Key Features**:
- Multi-format support: PDF, Word, PPT, Excel, images, and more
- MIT license (very permissive)
- Extensibility via plugins
- Easy to use and integrate
- General-purpose converter

**Limitations**:
- PDF conversion extracts plain text only
- No heading levels or layout preservation
- Basic compared to specialized tools

**Best For**:
- Quick conversions where layout isn't critical
- Multi-format pipelines
- Projects needing permissive licensing
- Integration into existing Python workflows

**Considerations**:
- Not ideal for complex PDF layouts
- May lose formatting details

---

### 4. Docling

**Description**: An open-source document processing toolkit with advanced layout analysis.

**Key Features**:
- Automatically analyzes PDF layouts
- Identifies reading order
- Recognizes table structures with high accuracy
- Supports DOCX, PPTX, XLSX, HTML, images, audio
- Integrates OCR engines: Tesseract, EasyOCR, RapidOCR
- Preserves complex layouts

**Best For**:
- Documents with complex layouts
- Table-heavy documents
- Projects requiring layout preservation
- Flexible open-source workflows

**Considerations**:
- Higher resource demands
- May require more setup than simpler tools

---

### 5. Dolphin (ByteDance)

**Description**: Uses Vision Transformer OCR and layout understanding to restore PDF layout and output structured Markdown/JSON.

**Key Features**:
- Automatically retains sections, paragraphs, tables, formulas, images, headings
- Deep learning two-stage parsing
- Runs locally via CLI (no internet required)
- Suitable for complex layouts and scanned documents

**Best For**:
- Scanned documents
- Complex layouts requiring layout understanding
- Offline/local processing requirements
- Privacy-sensitive documents

**Considerations**:
- Model weights must be downloaded
- Higher computational requirements

---

### 6. Pandoc

**Repository/Website**: https://pandoc.org/

**Description**: The Swiss Army knife of document conversion tools.

**Key Features**:
- Command-line converter
- Converts from dozens of markup file formats
- Supports Word, HTML, LaTeX, PDF to Markdown
- Understands Markdown syntax extensions
- Widely used and well-maintained
- Cross-platform

**Best For**:
- General-purpose conversions
- Batch processing
- Integration into scripts and workflows
- Academic writing workflows

**Considerations**:
- PDF conversion may be limited compared to specialized tools
- Better for markup-to-markup conversions

---

### 7. Pix2Text (P2T)

**Description**: Recognizes layouts, tables, images, text, and mathematical formulas, integrating all into Markdown format.

**Key Features**:
- Recognizes layouts, tables, images, text, and formulas
- Converts entire PDF files (including scanned images)
- Integrates all content types into unified Markdown
- Handles mixed content documents

**Best For**:
- Mixed content documents
- Documents with images and formulas
- Scanned PDFs
- Visual content preservation

**Considerations**:
- May require more processing time for complex documents

---

## Comparison Matrix

| Tool | Speed | Accuracy | Layout | Tables | Formulas | OCR | License | Best Use Case |
|------|-------|----------|--------|--------|----------|-----|---------|---------------|
| **Marker** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ✓ | Check | Complex docs, batch |
| **MinerU** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ✓ | OSS | Academic papers |
| **MarkItDown** | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐ | ⭐ | ✗ | MIT | Quick, simple docs |
| **Docling** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ✓ | OSS | Complex layouts |
| **Dolphin** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ✓ | OSS | Scanned docs |
| **Pandoc** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ | ✗ | GPL | General purpose |
| **Pix2Text** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ✓ | OSS | Mixed content |

## Recommendations by Use Case

### For Hive-Mind Integration

**Primary Recommendation**: **Marker**
- Fast processing for batch operations
- High accuracy across document types
- Good table and formula support
- Proven benchmarks vs commercial solutions

**Secondary Option**: **Docling**
- Excellent layout preservation
- Strong table recognition
- Flexible OCR integration
- Better for complex layouts

### For Academic/Research Documents

**Best Choice**: **MinerU**
- Purpose-built for academic content
- Excellent citation and formula handling
- Multiple output formats
- 109 language OCR support

### For Quick Prototyping

**Best Choice**: **MarkItDown** or **Pandoc**
- Easy to set up
- Fast processing
- Good for simple documents
- Permissive licensing

### For Scanned Documents

**Best Choice**: **Dolphin** or **Pix2Text**
- Advanced OCR capabilities
- Layout understanding
- Handles mixed content
- Local processing

## Implementation Strategy for Issue #655

Based on the PDF processing failure analysis, here's a recommended approach:

### Phase 1: Size Detection and Splitting
1. Detect PDF file size before processing
2. For large PDFs (>5MB), use a PDF-to-Markdown tool
3. Process resulting Markdown instead of base64 PDF

### Phase 2: Tool Integration
```javascript
// Pseudo-code for integration
async function processPDF(pdfPath) {
  const fileSize = getFileSize(pdfPath);

  if (fileSize > 5 * 1024 * 1024) { // 5MB threshold
    // Use Marker or MinerU to convert to Markdown
    const markdown = await convertToMarkdown(pdfPath);
    return markdown;
  } else {
    // Use existing Claude PDF reading
    return await readPDFDirectly(pdfPath);
  }
}
```

### Phase 3: Chunking Strategy
For very large Markdown outputs:
1. Split by sections or page count
2. Process chunks sequentially
3. Combine insights

## Installation Examples

### Marker
```bash
pip install marker-pdf
```

### MinerU
```bash
pip install magic-pdf
```

### MarkItDown
```bash
pip install markitdown
```

### Docling
```bash
pip install docling
```

### Pandoc
```bash
# Ubuntu/Debian
apt-get install pandoc

# macOS
brew install pandoc

# Windows
choco install pandoc
```

## Performance Considerations

### Token Efficiency
- Converting to Markdown typically reduces token count by 70-80% vs base64
- Example: 6.5MB PDFs = ~2.27M tokens as base64, ~500K tokens as Markdown
- Allows processing of larger documents within Claude's limits

### Processing Time
- PDF-to-Markdown conversion adds 5-30 seconds depending on document complexity
- Trade-off is acceptable for documents that would otherwise fail
- Can be done asynchronously or in background

### Accuracy Trade-offs
- Markdown conversion may lose some visual formatting
- Tables, formulas, and structure generally preserved well
- For critical documents, consider hybrid approach (images + text)

## References

- [Deep Dive into Open Source PDF to Markdown Tools](https://jimmysong.io/en/blog/pdf-to-markdown-open-source-deep-dive/)
- [Top 5 Tools to Convert PDF into Markdown](https://www.analyticsvidhya.com/blog/2025/05/pdf-to-markdown-converter/)
- [Marker GitHub Repository](https://github.com/datalab-to/marker)
- [MinerU GitHub Repository](https://github.com/opendatalab/MinerU)
- [PDF to Markdown Conversion Tools: Beyond the Hype](https://systenics.ai/blog/2025-07-28-pdf-to-markdown-conversion-tools/)

## Conclusion

For the hive-mind solver, **Marker** is the recommended primary tool due to its balance of speed, accuracy, and feature completeness. For specialized academic content, **MinerU** would be the better choice. A hybrid approach using different tools based on document type could provide optimal results.

The key insight from Issue #655 is that converting large PDFs to Markdown before processing with Claude can reduce token usage by 70-80%, making previously impossible tasks feasible within context window limits.

---

**Last Updated**: November 2025
**Related**: Issue #655, TECHNICAL_ANALYSIS.md, RECOMMENDATIONS.md
