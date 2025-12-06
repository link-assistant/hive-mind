# VoiceCapture: Comprehensive Project Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Features & Capabilities](#features--capabilities)
4. [Technology Stack](#technology-stack)
5. [Installation & Setup](#installation--setup)
6. [Configuration Guide](#configuration-guide)
7. [Usage Guide](#usage-guide)
8. [Project Structure](#project-structure)
9. [Development Guidelines](#development-guidelines)
10. [Troubleshooting](#troubleshooting)

---

## Project Overview

**VoiceCapture** is a Windows desktop application designed for rapid voice-to-text conversion using advanced AI speech recognition. The application enables users to input text by voice in any application through global hotkeys, with automatic transcription, post-processing, and clipboard insertion.

### Repository Information
- **GitHub**: [Metanoiabot/Voice](https://github.com/Metanoiabot/Voice)
- **Original Fork From**: [oiv-an/Voice](https://github.com/oiv-an/Voice)
- **Primary Language**: Python (99.6%)
- **License**: To be determined
- **Platform**: Windows 10/11

### Key Value Proposition
VoiceCapture solves the problem of slow typing by enabling hands-free text input across all Windows applications. The multi-backend approach ensures reliability and flexibility, while LLM post-processing ensures professional-quality output.

---

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    VoiceCapture System                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐     ┌──────────────┐    ┌──────────────┐ │
│  │   Global     │────▶│   Audio      │───▶│  Recognition │ │
│  │   Hotkey     │     │  Recording   │    │   Backend    │ │
│  │   Handler    │     │   Module     │    │   Selector   │ │
│  └──────────────┘     └──────────────┘    └──────────────┘ │
│         │                                         │          │
│         │                                         ▼          │
│         │                             ┌──────────────────┐  │
│         │                             │  Speech-to-Text  │  │
│         │                             │    Backends:     │  │
│         │                             │  • Groq Whisper  │  │
│         │                             │  • OpenAI API    │  │
│         │                             │  • GigaAM-v3     │  │
│         │                             └──────────────────┘  │
│         │                                         │          │
│         │                                         ▼          │
│         │                             ┌──────────────────┐  │
│         │                             │  LLM Post-       │  │
│         │                             │  Processing      │  │
│         │                             │  (GPT-4o/5.1)    │  │
│         │                             └──────────────────┘  │
│         │                                         │          │
│         ▼                                         ▼          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          PyQt6 User Interface                         │  │
│  │  • System Tray Integration                            │  │
│  │  • Settings Panel                                     │  │
│  │  • Idea List Manager                                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ▼                                  │
│                  ┌──────────────────┐                       │
│                  │   Clipboard &    │                       │
│                  │   Auto-paste     │                       │
│                  └──────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

1. **Input Layer**: Global hotkeys capture user recording intent
2. **Recording Layer**: Audio capture from system microphone
3. **Recognition Layer**: Multi-backend speech recognition with fallback logic
4. **Processing Layer**: Optional LLM-based text enhancement
5. **Output Layer**: Clipboard integration and automatic paste
6. **Interface Layer**: PyQt6 GUI for configuration and idea management

---

## Features & Capabilities

### 1. Voice Input System

#### Global Hotkey Activation
- **Primary Recording**: `Ctrl+Win` - Records voice and auto-pastes transcription
- **Idea Capture**: `Ctrl+Win+Alt` - Records to Idea List for later review
- **Cross-Application Support**: Works in any Windows application

#### Multi-Backend Recognition

**Backend Options:**

| Backend | Speed | Accuracy | Cost | Use Case |
|---------|-------|----------|------|----------|
| **Groq Whisper** | ⚡ Very Fast | High | API Cost | Quick dictation |
| **OpenAI API** | Medium | ⚡ Very High | API Cost | Professional content |
| **GigaAM-v3** | Slow | Medium | Free (Local) | Offline/Privacy |

**Smart Fallback Logic:**
- Automatic backend switching when local recognition fails
- Length-based threshold for local vs. cloud processing
- Configurable priority ordering

### 2. Idea Management System (v1.1.0)

The Idea List feature provides quick voice note capture:

- **Quick Capture**: Press `Ctrl+Win+Alt` to record ideas without interrupting workflow
- **Visual Management**: View and organize captured ideas in dedicated UI panel
- **Completion Tracking**: Strike-through completed items (auto-delete after 5 seconds)
- **Persistent Logging**: All ideas saved to `logs/ideas.log` with timestamps
- **Searchable History**: Full-text search through past ideas

### 3. LLM Post-Processing

Automatic text enhancement using language models:

**Supported Models:**
- GPT-4o (OpenAI)
- GPT-5.1 (OpenAI - latest)
- Groq models

**Enhancement Features:**
- Grammar correction
- Punctuation normalization
- Capitalization fixes
- Format standardization
- Context-aware improvements

**Configurable Options:**
- Enable/disable per recording mode
- Model selection
- Custom prompts for specific formatting styles

### 4. Auto-Paste Functionality

Seamless integration with active applications:

- Automatic clipboard population
- Configurable paste delay
- Clipboard history preservation
- Support for Unicode and special characters

---

## Technology Stack

### Core Technologies

**Programming Language:**
- Python 3.10+ (primary implementation)
- Batch scripting (launcher)

**UI Framework:**
- PyQt6 - Cross-platform GUI toolkit

**Speech Recognition:**
- Whisper (via Groq and OpenAI APIs)
- GigaAM-v3 (local model)

**Language Models:**
- GPT-4o, GPT-5.1 (OpenAI)
- Groq language models

**Audio Processing:**
- PyAudio or sounddevice for recording
- WAV/MP3 format support

### Development Approach

**"Vibe-Coding" Methodology:**
- Architecture design assisted by advanced AI (Claude, GPT-5.1, Gemini 3)
- Rapid prototyping with AI-generated code
- Iterative refinement based on user feedback

---

## Installation & Setup

### System Requirements

**Operating System:**
- Windows 10 (64-bit) or later
- Windows 11 (recommended)

**Hardware:**
- Minimum 4GB RAM
- Microphone (built-in or external)
- Internet connection (for cloud backends)

**Software Prerequisites:**
- Python 3.10 or higher
- Git (for repository cloning)

### Installation Steps

#### 1. Clone Repository
```bash
git clone https://github.com/Metanoiabot/Voice.git
cd Voice
```

#### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

**Expected Dependencies:**
- PyQt6
- requests (for API calls)
- pyaudio or sounddevice (audio recording)
- pynput or keyboard (global hotkeys)
- Additional model-specific libraries

#### 3. Initial Launch
```bash
python src/main.py
```

**First-Time Setup:**
- Configuration file `config.yaml` auto-generates
- System tray icon appears
- Settings panel opens automatically

#### 4. Configure API Keys

Edit `config.yaml` or use Settings GUI to add:

```yaml
api_keys:
  groq_api_key: "your-groq-api-key"
  openai_api_key: "your-openai-api-key"
```

### Quick Start Alternative

Use the provided batch launcher:
```batch
start_voicecapture.bat
```

---

## Configuration Guide

### Configuration File Structure

Location: `config.yaml` (generated in project root)

```yaml
# Hotkey Configuration
hotkeys:
  record_and_paste: "ctrl+win"
  record_idea: "ctrl+win+alt"

# Recognition Backend Settings
recognition:
  primary_backend: "groq"  # Options: groq, openai, local
  fallback_enabled: true
  backends:
    groq:
      enabled: true
      model: "whisper-large-v3"
    openai:
      enabled: true
      model: "whisper-1"
    local:
      enabled: false
      model_path: "models/gigaam-v3"

# Post-Processing Configuration
post_processing:
  enabled: true
  provider: "openai"  # Options: openai, groq
  model: "gpt-4o"
  custom_prompt: "Correct grammar and punctuation, maintain original meaning"

# Audio Settings
audio:
  sample_rate: 16000
  channels: 1
  chunk_size: 1024
  format: "wav"

# Paste Settings
paste:
  auto_paste: true
  delay_ms: 100

# Idea List Settings
ideas:
  log_file: "logs/ideas.log"
  auto_delete_completed_delay: 5  # seconds

# Logging
logging:
  level: "INFO"  # DEBUG, INFO, WARNING, ERROR
  file: "logs/voicecapture.log"
```

### GUI Configuration

Access through system tray icon → Settings:

1. **Hotkeys Tab**: Customize keyboard shortcuts
2. **Recognition Tab**: Select and configure backends
3. **Processing Tab**: LLM post-processing options
4. **Audio Tab**: Recording parameters
5. **Advanced Tab**: Logging and performance settings

---

## Usage Guide

### Basic Voice Input

1. **Position Cursor**: Click in any text field (Word, browser, IDE, etc.)
2. **Press Hotkey**: `Ctrl+Win`
3. **Recording Indicator**: Visual feedback appears
4. **Speak Clearly**: Dictate your text
5. **Release Hotkey**: Recording stops, processing begins
6. **Auto-Insert**: Text appears at cursor position

### Idea Capture Workflow

1. **Quick Capture**: Press `Ctrl+Win+Alt` while working
2. **Record Idea**: Speak your thought/note
3. **Release**: Idea saved to list
4. **Review**: Open Idea List panel from system tray
5. **Mark Complete**: Click to strike-through completed ideas
6. **History**: View `logs/ideas.log` for past ideas

### Backend Selection Strategy

**Use Groq** when:
- Need fast response
- Dictating casual content
- Working on time-sensitive tasks

**Use OpenAI** when:
- Accuracy is critical
- Professional/formal content
- Complex technical terminology

**Use Local (GigaAM-v3)** when:
- Privacy required
- No internet connection
- Avoiding API costs

### Tips for Best Results

1. **Clear Audio**: Use quality microphone in quiet environment
2. **Natural Speech**: Speak at normal pace, avoid rushing
3. **Punctuation**: Say punctuation marks verbally if LLM processing disabled
4. **Short Bursts**: Record 30-60 second segments for best accuracy
5. **Review Output**: Check transcription before final submission

---

## Project Structure

```
Voice/
│
├── src/                          # Source code
│   ├── main.py                   # Application entry point
│   │
│   ├── config/                   # Configuration management
│   │   ├── __init__.py
│   │   ├── config_manager.py    # YAML config loader/saver
│   │   └── defaults.py          # Default configuration values
│   │
│   ├── ui/                       # PyQt6 user interface
│   │   ├── __init__.py
│   │   ├── main_window.py       # Main application window
│   │   ├── system_tray.py       # System tray integration
│   │   ├── settings_dialog.py   # Settings configuration UI
│   │   └── idea_list.py         # Idea management panel
│   │
│   ├── audio/                    # Audio recording
│   │   ├── __init__.py
│   │   ├── recorder.py          # Audio capture logic
│   │   └── audio_utils.py       # Audio format conversions
│   │
│   ├── recognition/              # Speech recognition
│   │   ├── __init__.py
│   │   ├── backend_selector.py  # Backend routing logic
│   │   ├── groq_backend.py      # Groq API integration
│   │   ├── openai_backend.py    # OpenAI API integration
│   │   ├── local_backend.py     # GigaAM-v3 local model
│   │   └── post_processor.py    # LLM text enhancement
│   │
│   └── hotkey/                   # Global hotkey handling
│       ├── __init__.py
│       └── hotkey_manager.py    # System-wide keyboard hooks
│
├── assets/                       # Application resources
│   └── icons/                    # System tray and UI icons
│       ├── app_icon.ico
│       ├── recording.png
│       └── settings.png
│
├── docs/                         # Documentation
│   └── (to be expanded)
│
├── tests/                        # Unit and integration tests
│   ├── __init__.py
│   ├── test_audio.py
│   ├── test_recognition.py
│   └── test_config.py
│
├── logs/                         # Application logs
│   ├── ideas.log                # Idea capture history
│   └── voicecapture.log         # Application log
│
├── models/                       # Local model storage (optional)
│   └── gigaam-v3/               # Local recognition model
│
├── .gitignore                    # Git ignore rules
├── README.md                     # Project readme
├── requirements.txt              # Python dependencies
├── config.yaml                   # User configuration (auto-generated)
└── start_voicecapture.bat        # Windows launcher script
```

### Key File Descriptions

| File | Purpose |
|------|---------|
| `src/main.py` | Application entry point, initializes components |
| `src/config/config_manager.py` | Loads/saves YAML configuration |
| `src/ui/system_tray.py` | System tray icon and menu |
| `src/audio/recorder.py` | Microphone audio capture |
| `src/recognition/backend_selector.py` | Routes requests to appropriate backend |
| `src/hotkey/hotkey_manager.py` | Global keyboard event hooks |

---

## Development Guidelines

### Development Methodology

VoiceCapture follows the **"Vibe-Coding"** approach:

1. **AI-Assisted Architecture**: Use Claude/GPT for design decisions
2. **Rapid Prototyping**: Implement features quickly with AI code generation
3. **User-Centric Iteration**: Refine based on real-world usage
4. **Quality Through Testing**: Validate with automated and manual tests

### Coding Standards

**Python Style:**
- Follow PEP 8 conventions
- Type hints for all function signatures
- Docstrings for public methods
- Maximum line length: 100 characters

**Example:**
```python
def transcribe_audio(
    audio_data: bytes,
    backend: str = "groq"
) -> dict[str, str | float]:
    """
    Transcribe audio to text using specified backend.

    Args:
        audio_data: Raw audio bytes in WAV format
        backend: Recognition backend name (groq/openai/local)

    Returns:
        Dictionary with 'text' and 'confidence' keys
    """
    pass
```

### Testing Strategy

**Test Categories:**
1. **Unit Tests**: Individual component logic
2. **Integration Tests**: Backend API interactions
3. **UI Tests**: PyQt6 interface functionality
4. **End-to-End Tests**: Full workflow validation

**Running Tests:**
```bash
python -m pytest tests/
```

### Contributing Workflow

1. Fork repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Implement changes with tests
4. Ensure all tests pass
5. Submit pull request with detailed description

---

## Troubleshooting

### Common Issues

#### 1. Hotkeys Not Working

**Symptoms:** Pressing hotkey combinations does nothing

**Solutions:**
- Check if another application uses same hotkeys
- Run VoiceCapture as Administrator
- Verify `config.yaml` hotkey syntax
- Check system keyboard settings

#### 2. Recognition Errors

**Symptoms:** "Recognition failed" or poor transcription quality

**Solutions:**
- Verify API keys in `config.yaml`
- Check internet connection (for cloud backends)
- Test microphone with Windows Sound Recorder
- Reduce background noise
- Switch to alternative backend

#### 3. Auto-Paste Not Working

**Symptoms:** Text transcribed but not inserted

**Solutions:**
- Verify target application accepts clipboard paste
- Increase `paste_delay_ms` in config
- Check clipboard permissions
- Test manual paste (`Ctrl+V`)

#### 4. High API Costs

**Symptoms:** Unexpected API billing

**Solutions:**
- Enable local backend for non-critical use
- Disable LLM post-processing for drafts
- Set usage limits in API dashboard
- Monitor `logs/voicecapture.log` for request counts

#### 5. Application Crashes

**Symptoms:** VoiceCapture closes unexpectedly

**Solutions:**
- Check `logs/voicecapture.log` for error messages
- Update to latest Python version
- Reinstall dependencies: `pip install -r requirements.txt --upgrade`
- Report issue on GitHub with log file

### Debug Mode

Enable detailed logging:

```yaml
logging:
  level: "DEBUG"
```

Restart application and check `logs/voicecapture.log` for detailed execution trace.

### Getting Help

1. **GitHub Issues**: [Report bugs or request features](https://github.com/Metanoiabot/Voice/issues)
2. **Documentation**: Check this guide and README.md
3. **Logs**: Always include relevant log excerpts when seeking help

---

## Appendix: API Integration Details

### Groq API Setup

1. Create account at [groq.com](https://groq.com)
2. Generate API key from dashboard
3. Add to `config.yaml`:
```yaml
api_keys:
  groq_api_key: "gsk_..."
```

### OpenAI API Setup

1. Create account at [platform.openai.com](https://platform.openai.com)
2. Navigate to API keys section
3. Create new key with appropriate permissions
4. Add to `config.yaml`:
```yaml
api_keys:
  openai_api_key: "sk-..."
```

### Local Model Setup (GigaAM-v3)

1. Download model from official source
2. Extract to `models/gigaam-v3/`
3. Enable in configuration:
```yaml
recognition:
  backends:
    local:
      enabled: true
      model_path: "models/gigaam-v3"
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-06
**Author**: AI Documentation Generator
**Repository**: [Metanoiabot/Voice](https://github.com/Metanoiabot/Voice)
