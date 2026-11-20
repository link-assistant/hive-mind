// These formats escaped automatic sanitization in the Control Center's first archive.
const identityPatterns = [/[PIACV][A-Z<][A-Z]{3}[A-Z]{2,}(?:<[A-Z]+)*<<[A-Z][A-Z<]*/g, /[A-Z0-9<]{9}[0-9<][A-Z]{3}[0-9]{6}[0-9<][MFX<][0-9]{6}[A-Z0-9<]{0,16}/g, /\b\d{2} \d{2} \d{6}\b/g, /(?<=(?:passport|паспорт|visa|виза|document|документ)[^\n]{0,24}?(?:no\.?|number|num|#|№|номер|серия)[^A-Za-z0-9\n]{0,8})[A-Z]{0,2}[0-9][0-9 ]{2,12}[0-9]/giu, /(?<=(?:booking ref(?:erence)?|reservation (?:code|number)|pnr|бронирован\S{0,12})[^A-Za-z0-9\n]{1,8})[A-Z0-9]{3,8}\b/giu, /(?<=(?:date of birth|birth ?date|dob|born|дата рождения|д\.р\.)[^0-9\n]{0,12})[0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4}/giu, /(?<=(?:whatsapp|zalo|viber|telegram|signal|wechat|kakaotalk|phone|mobile|телефон)[^0-9+\n]{0,12})\+?\d[\d ()-]{7,16}\d/giu];

export function redactArchiveIdentity(text) {
  for (const pattern of identityPatterns) text = text.replace(pattern, '[REDACTED]');
  return text;
}

export function excludedArchiveRepository(repository) {
  return repository === 'konard/documents-processing';
}
