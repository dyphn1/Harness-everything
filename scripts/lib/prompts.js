// Terminal TUI primitives used by the interactive installer flow. No install
// or filesystem logic lives here - purely input/output.
const readline = require('readline');

function interactiveSelect(items, pageSize = items.length) {
  return new Promise((resolve) => {
    let cursor = 0;
    let scrollIndex = 0;
    let visibleItems = [];
    const isScrollable = items.length > pageSize;

    function render() {
      readline.cursorTo(process.stdout, 0);

      if (isScrollable) {
        if (cursor >= scrollIndex + pageSize) {
          scrollIndex = cursor - pageSize + 1;
        } else if (cursor < scrollIndex) {
          scrollIndex = cursor;
        }
      }

      visibleItems = items.slice(scrollIndex, scrollIndex + pageSize);
      const writeLines = [];

      if (isScrollable) {
        if (scrollIndex > 0) {
          writeLines.push(`  ▲ (more above)`);
        } else {
          writeLines.push(``); // Spacer
        }
      }

      for (let i = 0; i < visibleItems.length; i++) {
        const itemIndex = scrollIndex + i;
        const item = visibleItems[i];
        const isSelected = item.checked ? '[x]' : '[ ]';
        const isCurrent = itemIndex === cursor ? '> ' : '  ';
        const desc = item.description ? ` - ${item.description}` : '';
        const lineText = `${isCurrent}${isSelected} ${item.name || item.id}${desc}`;
        const maxCols = process.stdout.columns || 80;
        const truncated = lineText.length > maxCols - 5
          ? lineText.slice(0, maxCols - 8) + '...'
          : lineText;
        writeLines.push(truncated);
      }

      if (isScrollable) {
        if (scrollIndex + pageSize < items.length) {
          writeLines.push(`  ▼ (more below)`);
        } else {
          writeLines.push(``); // Spacer
        }
      }

      writeLines.push(``);
      writeLines.push(`(Use Up/Down Arrow keys to navigate, Space to toggle, Enter to confirm)`);

      for (const line of writeLines) {
        readline.clearLine(process.stdout, 0);
        process.stdout.write(`${line}\n`);
      }
    }

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Hide cursor
    process.stdout.write('[?25l');

    render();

    function cleanup() {
      // Show cursor again
      process.stdout.write('[?25h');
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    function handleKeypress(str, key) {
      if (key) {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }

        const linesToMove = pageSize + (isScrollable ? 4 : 2);

        if (key.name === 'up') {
          cursor = (cursor - 1 + items.length) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'down') {
          cursor = (cursor + 1) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'space' || str === ' ') {
          const itemIndex = cursor;
          items[itemIndex].checked = !items[itemIndex].checked;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          readline.moveCursor(process.stdout, 0, -linesToMove);
          for (let i = 0; i < linesToMove; i++) {
            readline.clearLine(process.stdout, 0);
            process.stdout.write('\n');
          }
          readline.moveCursor(process.stdout, 0, -linesToMove);

          for (let i = 0; i < visibleItems.length; i++) {
            readline.clearLine(process.stdout, 0);
            const item = visibleItems[i];
            const isSelected = item.checked ? '✔' : ' ';
            process.stdout.write(`  ${isSelected} ${item.name || item.id}\n`);
          }
          if (isScrollable) {
            readline.clearLine(process.stdout, 0);
            process.stdout.write('\n');
          }
          readline.clearLine(process.stdout, 0);
          process.stdout.write('\n');
          resolve(items);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function interactiveSingleSelect(items) {
  return new Promise((resolve) => {
    let cursor = 0;
    if (!items.some(i => i.checked)) {
      items[0].checked = true;
    }

    function render() {
      readline.cursorTo(process.stdout, 0);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isSelected = item.checked ? '(o)' : '( )';
        const isCurrent = i === cursor ? '> ' : '  ';
        readline.clearLine(process.stdout, 0);
        process.stdout.write(`${isCurrent}${isSelected} ${item.name}\n`);
      }
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`\n`);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`(Use Up/Down Arrow keys to navigate, Space to select, Enter to confirm)\n`);
    }

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdout.write('[?25l');
    render();

    function cleanup() {
      process.stdout.write('[?25h');
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    function handleKeypress(str, key) {
      if (key) {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }

        const linesToMove = items.length + 2;

        if (key.name === 'up') {
          cursor = (cursor - 1 + items.length) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'down') {
          cursor = (cursor + 1) % items.length;
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'space' || str === ' ') {
          items.forEach((item, idx) => {
            item.checked = (idx === cursor);
          });
          readline.moveCursor(process.stdout, 0, -linesToMove);
          render();
        } else if (key.name === 'return' || key.name === 'enter') {
          items.forEach((item, idx) => {
            item.checked = (idx === cursor);
          });
          cleanup();
          readline.moveCursor(process.stdout, 0, -linesToMove);
          for (let i = 0; i < linesToMove; i++) {
            readline.clearLine(process.stdout, 0);
            process.stdout.write('\n');
          }
          readline.moveCursor(process.stdout, 0, -linesToMove);

          for (let i = 0; i < items.length; i++) {
            readline.clearLine(process.stdout, 0);
            const item = items[i];
            const isSelected = item.checked ? '✔' : ' ';
            process.stdout.write(`  ${isSelected} ${item.name}\n`);
          }
          readline.clearLine(process.stdout, 0);
          process.stdout.write('\n');
          resolve(items.find(item => item.checked).id);
        }
      }
    }
    process.stdin.on('keypress', handleKeypress);
  });
}

module.exports = { interactiveSelect, interactiveSingleSelect, askQuestion };
