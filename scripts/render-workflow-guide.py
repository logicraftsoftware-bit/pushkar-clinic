"""Render the small staff guide as a standalone printable HTML document (stdlib only)."""
from pathlib import Path
import html
import re

source = Path('docs/CLINIC-WORK-PROCESS.md')
target = source.with_suffix('.html')
existing = target.read_text(encoding='utf-8')
style = re.search(r'<style>(.*?)</style>', existing, re.S).group(1)

def inline(value):
    value = html.escape(value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', value)

blocks, table, list_kind = [], [], None
for line in source.read_text(encoding='utf-8').splitlines() + ['']:
    if line.startswith('|'):
        if list_kind:
            blocks.append('</' + list_kind + '>')
            list_kind = None
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if all(re.fullmatch(r':?-+:?', cell) for cell in cells):
            continue
        tag = 'th' if not table else 'td'
        table.append('<tr>' + ''.join(f'<{tag}>{inline(cell)}</{tag}>' for cell in cells) + '</tr>')
        continue
    if table:
        blocks.append('<div class="table-wrap"><table>' + ''.join(table) + '</table></div>')
        table = []
    item = re.match(r'^(?:\d+\. |(-) )(.*)', line)
    if item:
        kind = 'ul' if item.group(1) else 'ol'
        if list_kind != kind:
            if list_kind:
                blocks.append('</' + list_kind + '>')
            blocks.append('<' + kind + '>')
            list_kind = kind
        blocks.append('<li>' + inline(item.group(2)) + '</li>')
        continue
    if list_kind:
        blocks.append('</' + list_kind + '>')
        list_kind = None
    if not line.strip():
        continue
    heading = re.match(r'^(#{1,3}) (.*)', line)
    if heading:
        level = len(heading.group(1))
        blocks.append(f'<h{level}>{inline(heading.group(2))}</h{level}>')
    else:
        blocks.append('<p>' + inline(line) + '</p>')

target.write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pushkar Clinic ERP — Staff Work Process</title><style>' + style + '</style><div class="print">Staff guide · Use your browser’s Print command to print or save as PDF.</div><main>' + ''.join(blocks) + '</main></html>', encoding='utf-8')
