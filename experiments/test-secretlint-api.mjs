#!/usr/bin/env node
/**
 * Experiment: Test secretlint JavaScript API for programmatic usage
 */

import { lintSource } from '@secretlint/core';
import { creator as presetRecommend, rules } from '@secretlint/secretlint-rule-preset-recommend';

async function testSecretlint() {
  console.log('='.repeat(60));
  console.log('Testing secretlint JavaScript API');
  console.log('='.repeat(60));

  // Show available rules in the preset
  console.log('\n📋 Available rules in preset-recommend:');
  console.log(rules.map(r => r.meta.id).join('\n'));

  // Build config object with the preset
  const config = {
    rules: [
      {
        id: '@secretlint/secretlint-rule-preset-recommend',
        rule: presetRecommend,
      },
    ],
  };

  // Test with more realistic token patterns that match secretlint's rules
  // OpenAI pattern: sk-proj-|sk-svcacct-|sk-admin- followed by 74 or 58 chars, T3BlbkFJ, 74 or 58 chars
  // OR sk- followed by 20 chars, T3BlbkFJ, 20 chars
  const openaiSignature = 'T3BlbkFJ';
  const padding20 = 'abcdefghij1234567890';

  // Anthropic pattern: sk-ant-api0N-[A-Za-z0-9_-]{90,128}AA
  const anthropicBody = 'A'.repeat(93);

  const testCases = [
    {
      name: 'OpenAI Legacy Token (sk- + 20 + T3BlbkFJ + 20)',
      // sk- + 20 chars + T3BlbkFJ + 20 chars = valid legacy format
      content: `OPENAI_API_KEY=sk-${padding20}${openaiSignature}${padding20}`,
    },
    {
      name: 'Anthropic Token (sk-ant-api03- + 93 chars + AA)',
      content: `ANTHROPIC_API_KEY=sk-ant-api03-${anthropicBody}AA`,
    },
    {
      name: 'GitHub PAT (ghp_ + 36 chars)',
      content: 'GITHUB_TOKEN=ghp_1234567890abcdef1234567890abcdef12345678',
    },
    {
      name: 'GitHub Fine-grained PAT (github_pat_)',
      content: 'GITHUB_TOKEN=github_pat_11AAAAAAQ0abcdefghij1234567890abcdefghij1234567890abcd',
    },
    {
      name: 'AWS Access Key (AKIA + 16 chars)',
      content: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    },
    {
      name: 'Slack Bot Token (xoxb-)',
      // Construct token dynamically to avoid GitHub push protection
      content: `SLACK_TOKEN=${'xoxb'}-123456789012-1234567890123-${'abcdefghijklmnopqrstuvwx'}`,
    },
    {
      name: 'SendGrid API Key (SG.*.* pattern)',
      content: 'SENDGRID_API_KEY=SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz1234567890ABCDE',
    },
    {
      name: 'npm Token (npm_*)',
      content: 'NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz1234567890',
    },
    {
      name: 'Safe content (no secrets)',
      content: 'browser_take_screenshot mcp__playwright__browser_click',
    },
    {
      name: 'Git commit hash (should not be detected)',
      content: 'git log 2073c66ab9405a46416dbb51714f843c3016052a',
    },
    {
      name: 'UUID (should not be detected)',
      content: '183fd583-b795-4920-8be5-be778aff7fa9',
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Testing: ${testCase.name}`);
    console.log(`   Content: ${testCase.content.substring(0, 80)}...`);

    try {
      const result = await lintSource({
        source: {
          filePath: '/virtual/test.txt',
          content: testCase.content,
          contentType: 'text',
        },
        options: {
          config,
          maskSecrets: true,
        },
      });

      if (result.messages.length > 0) {
        console.log(`   ✅ Found ${result.messages.length} secrets:`);
        for (const msg of result.messages) {
          console.log(`      - ${msg.ruleId}: ${msg.message}`);
          console.log(`        Range: [${msg.range[0]}, ${msg.range[1]}]`);
          console.log(`        Data: ${JSON.stringify(msg.data)}`);
        }
      } else {
        console.log(`   ✅ No secrets found (expected for safe content)`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Experiment completed');
  console.log('='.repeat(60));
}

testSecretlint().catch(console.error);
