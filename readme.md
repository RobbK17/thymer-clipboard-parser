# Thymer Clipboard Parser

Version: 1.0.6

Thymer Clipboard Parser is a global Thymer app plugin for quickly creating Thymer pages from clipboard content. It can capture plain text, HTML, and images. Create and run saved parser profiles with preview, then open the new page after saving in Thymer.

## Commands

- `ClipParser: Create record from clipboard` creates a new page from the current clipboard contents.
- `ClipParser: Run saved parser profile...` opens a saved profile picker, shows a projected output preview, then creates records after confirmation.
- `ClipParser: Settings` opens a unified settings panel for choosing a default target collection and managing saved parser profiles.

## Target Collection

The plugin writes clips to the first available target in this order:

1. `custom.target_collection_name` from `plugin.json` or the settings panel, matched case-insensitively by collection name.
2. The active non-journal collection in the focused panel.
3. A non-journal collection inferred from another open panel or page.

Journal collections are skipped because the plugin creates regular records.

## Configuration

Set a default destination in `plugin.json`:

```json
{
  "custom": {
    "target_collection_name": "Inbox"
  }
}
```

Leave `target_collection_name` empty to use the active open collection.

Parser profiles can be added under `custom.parser_profiles` for reusable parsing specs:

```json
{
  "custom": {
    "parser_profiles": [
      {
        "name": "Markdown Headings",
        "mode": "regexSections",
        "sectionStartRegex": "^#{1,6}\\s+(.+)$",
        "parentTitle": "Parsed Notes",
        "parentTitlePrefix": "Clipboard Week",
        "childTitle": "{heading}",
        "childBody": "{heading}\n{body}",
        "parentPageName": "",
        "tag": "#notes",
        "createParentLinks": true,
        "stripBlankLines": false
      }
    ]
  }
}
```

## Parser Modes

`ClipParser: Settings` is split into `General` and `Parser Profiles` tabs. The `Parser Profiles` tab includes a sample clipboard data box so you can preview projected output while creating or editing a profile.

Saved parser profiles support:

- `One page`: creates one page from the clipboard text.
- `Split by delimiter`: splits text using a delimiter such as `---`.
- `Weekday sections`: splits sections that start with Monday through Sunday. To auto-generate a dated parent title, put the month and day after the weekday, such as `Monday May 6`; bare weekday headings create sections but cannot provide a date range.
- `Split by regex heading`: splits sections when a line matches `sectionStartRegex`.

The parser validates the spec, limits generated child pages, and shows a preview before anything is written when you run a saved profile.

Saved profiles can be managed from `ClipParser: Settings`:

- `New` creates a starter profile.
- `Duplicate` copies the selected profile.
- `Delete` removes the selected profile.
- `Save settings` persists the target collection and all profile edits.

Paste representative text into `Sample clipboard data` while editing a profile to see the projected parent title, child pages, tags, blank-line handling, and warnings before using the profile on your real clipboard.

## Bundled Sample Profiles

`plugin.json` includes sample parser profiles you can run as-is, duplicate, or edit from `ClipParser: Settings`:

- `r/F45 Intel Week` parses weekday sections from an r/F45 weekly intel post, creates a parent page under `r/F45`, applies `#wellness`, creates parent links, and strips blank lines. The standalone `f45parse.js` plugin contains the dedicated r/F45 command.
- `Sample One Page Note` creates a single page named `Sample Clipboard Note` from the whole clipboard and applies `#inbox`.
- `Example Delimiter Sections` splits clipboard text on `---`, creates child pages titled with the section index and heading, and applies `#notes`.
- `Sample Weekly Plan` splits weekday sections into child pages, prefixes the parent page with `Sample Weekly Plan`, formats child titles as `{day}: {heading}`, and applies `#planning`.
- `Example Markdown Headings` splits markdown-like content whenever a heading line such as `# Topic` or `## Topic` is found, then imports each section with `#import`.
- `Sample Numbered List Sections` splits numbered outlines such as `1. First topic` or `2) Second topic`, creates indexed child page titles, and applies `#outline`.

Sample clipboard data is included in GitHub as `Delimiter data.txt`, `f45 Intel Data.txt`, `Markdown data.txt`, and `Numbered data.txt`.

## Template References

`childTitle` and `childBody` can include template references that are filled from each parsed clipboard section:

- `{heading}` is the section title found in the clipboard. For delimiter mode, this is the first non-empty line in that chunk. For weekday mode, this is the weekday line such as `Monday May 6`. For regex mode, this is the first capture group from `sectionStartRegex`, or the whole matching line when there is no capture group.
- `{body}` is the clipboard text inside that section after the heading line. In delimiter mode, it is the remaining lines after the first non-empty line.
- `{index}` is the section number, starting at `1`.
- `{day}` is the weekday name for `Weekday sections`, such as `Monday`. It is blank for other parser modes.
- `{parentTitle}` is the title of the parent page that will contain the generated child pages.

For example, `childBody` set to `{heading}\n{body}` creates each child page with the heading repeated as the first line, followed by that section's clipboard content.

Enable `stripBlankLines` when a profile should remove empty lines from generated child page bodies. This is useful for clipboard sources like r/F45 posts, where blank spacing is not meaningful and the dedicated parser also strips it.

## Clipboard Notes

The plugin uses the browser Clipboard API. If the clipboard is empty, `Create record from clipboard` and `Run saved parser profile...` stop with a toaster asking you to copy data and try again. If clipping fails, allow clipboard access for Thymer when prompted by the browser and run the command again.
