// scripts/lib/parse-sql.ts
// Splits a raw SQL migration file into individual statements while
// correctly handling:
//   - multi-line statements (terminated by ; at end of line)
//   - dollar-quoted strings ($$...$$) whose bodies may contain semicolons
//   - full-line comments (-- ...) outside of statements
export function parseStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;

  for (const line of sqlText.split('\n')) {
    const trimmed = line.trim();
    // Skip pure comment lines, but only while not inside a statement
    if (trimmed.startsWith('--') && !current.trim()) continue;

    // Toggle dollar-quote state: odd number of $$ occurrences flips it
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }

    current += line + '\n';

    // Only split on ; when NOT inside a dollar-quoted block
    if (trimmed.endsWith(';') && !inDollarQuote) {
      const stmt = current.trim();
      if (stmt.length > 0) statements.push(stmt);
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}