#!/usr/bin/env node

// Test script to verify the auto-continue time parsing logic

// Helper function to parse time string (copied from solve.mjs)
const parseResetTime = timeStr => {
  // Parse time format like "5:30am" or "11:45pm"
  const match = timeStr.match(/(\d{1,2}):(\d{2})([ap]m)/i);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  const [, hourStr, minuteStr, ampm] = match;
  let hour = parseInt(hourStr);
  const minute = parseInt(minuteStr);

  // Convert to 24-hour format
  if (ampm.toLowerCase() === 'pm' && hour !== 12) {
    hour += 12;
  } else if (ampm.toLowerCase() === 'am' && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
};

// Calculate milliseconds until the next occurrence of the specified time
const calculateWaitTime = resetTime => {
  const { hour, minute } = parseResetTime(resetTime);

  const now = new Date();
  const today = new Date(now);
  today.setHours(hour, minute, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (today <= now) {
    today.setDate(today.getDate() + 1);
  }

  return today.getTime() - now.getTime();
};

// Test different time formats
const testTimes = ['5:30am', '11:45pm', '12:00am', '12:00pm', '1:15pm', '9:05am'];

console.log('🧪 Testing auto-continue time parsing logic');
console.log(`Current time: ${new Date().toLocaleString()}\n`);

for (const time of testTimes) {
  try {
    const parsed = parseResetTime(time);
    const waitMs = calculateWaitTime(time);
    const waitMinutes = Math.round(waitMs / (1000 * 60));
    const nextTime = new Date(Date.now() + waitMs);

    console.log(`⏰ ${time.padEnd(8)} → ${parsed.hour.toString().padStart(2, '0')}:${parsed.minute.toString().padStart(2, '0')} → Wait: ${waitMinutes} min → Next: ${nextTime.toLocaleString()}`);
  } catch (error) {
    console.log(`❌ ${time.padEnd(8)} → Error: ${error.message}`);
  }
}

// Test the regex pattern detection
console.log('\n🔍 Testing limit detection pattern');
const testMessages = ['5-hour limit reached ∙ resets 5:30am', '24-hour limit reached • resets 11:45pm', 'Your 5-hour limit reached and resets 2:15pm', 'limit reached', 'generic limit message'];

const resetPattern = /(\d+)-hour limit reached.*?resets (\d{1,2}:\d{2}[ap]m)/i;

for (const message of testMessages) {
  const match = message.match(resetPattern);
  if (match) {
    const [, hours, resetTime] = match;
    console.log(`✅ "${message}" → ${hours} hours, resets ${resetTime}`);
  } else {
    console.log(`❌ "${message}" → No match`);
  }
}

console.log('\n✅ Test completed');
