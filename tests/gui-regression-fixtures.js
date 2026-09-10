const prose = 'פסקה רגילה בעברית עם שו"ע, יו״ד, מקף־עברי וסימני פיסוק: האם היא נתמכת? כן!';
const before = 'פסקה אחרת עם תוכן רגיל: {הגה והסבר נוסף השייך לפסקה האחרת בלבד:}';
const after = 'פסקה נפרדת נוספת עם תוכן רגיל {ביאור נוסף בסוגריים מסולסלים}';
const surrounded = `${before}\n\n${prose}\n\n${after}`;

module.exports = [
  { name: "isolated Hebrew", text: prose, line: 0, ch: 0, start: 0 },
  { name: "inline Hebrew braced explanation", text: 'טקסט עברי רגיל {הגה וביאור נוסף בעברית:}', line: 0, ch: 8, start: 0 },
  { name: "parenthesized braced explanation", text: 'טקסט עברי רגיל {(הערה נוספת בעברית) (מקור נוסף)}', line: 0, ch: 35, start: 0 },
  { name: "long braced RTL explanation", text: `טקסט עברי {הגה ${(prose + " ").repeat(30).trim()}}`, line: 0, ch: 500, start: 0 },
  { name: "multiline braced explanation", text: 'טקסט עברי {הגה והסבר\nנוסף בעברית}\nהמשך אותה פסקה', line: 1, ch: 4, start: 0 },
  { name: "actual false-positive shape at beginning", text: surrounded, line: 2, ch: 0, start: 2 },
  { name: "actual false-positive shape in middle", text: surrounded, line: 2, ch: 25, start: 2 },
  { name: "actual false-positive shape at end", text: surrounded, line: 2, ch: prose.length, start: 2 },
  { name: "long visually wrapped Hebrew", text: `${before}\n\n${(prose + " ").repeat(40).trim()}\n\n${after}`, line: 2, ch: 700, start: 2 },
  { name: "multiple logical source lines", text: `${before}\n\n${prose}\nשורת המשך באותה פסקה\nועוד שורה בעברית\n\n${after}`, line: 3, ch: 10, start: 2 },
  { name: "multiple blank lines around paragraph", text: `${before}\n\n\n${prose}\n\n\n${after}`, line: 3, ch: 10, start: 3 },
  { name: "decorations absent from source", text: surrounded, line: 2, ch: 10, start: 2 },
  { name: "existing foreign ID beside unrelated prose", text: `${before}\n\n${prose} ^existing-User\n\n${after}`, line: 2, ch: 10, start: 2, id: "existing-User" },
  { name: "existing SmartPaste ID", text: `${prose} ^aag-1234567890abcdef`, line: 0, ch: 10, start: 0, id: "aag-1234567890abcdef" },
  { name: "multiline neighboring paragraph", text: `פסקה קודמת\nעם תוכן נוסף {ביאור בעברית}\n\n${prose}`, line: 3, ch: 0, start: 3 }
];
