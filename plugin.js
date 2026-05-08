/**
 * Thymer Clipboard Parser — app (global) plugin
 * Version: 1.0.6
 *
 * Command Palette:
 * - "Create record from clipboard"
 * - "Run saved parser profile..." - choose a saved parser profile and preview records before writing
 * - "Clipboard Parser settings" - configure target collection and parser profiles
 *
 * Target collection (first match wins):
 * 1. custom.target_collection_name from settings / plugin JSON (case-insensitive name match)
 * 2. Otherwise: active panel's getActiveCollection(), then other panels; then navigation
 *    (overview rootId = collection guid, or edit_panel record → lookup).
 *
 * Flow: copy text, rich HTML, and/or images → Thymer → run the command → enter clip title.
 *
 * Perceived-speed strategy for parse flows: create parent + all child records and bodies,
 * navigate to the parent immediately, then create parent→child link items in the background.
 */

const CLIPPER_SETTINGS_PANEL_ID = "clipper-settings";
const MAX_PARSE_CHILDREN = 200;
const RECORD_RESOLVE_RETRY_MS = 25;
const RECORD_RESOLVE_RETRY_COUNT = 6;
const DEFAULT_PARSE_SPEC = {
  name: "One page",
  mode: "onePage",
  parentTitle: "",
  parentTitlePrefix: "Clipboard Week",
  delimiter: "---",
  sectionStartRegex: "^#{1,6}\\s+(.+)$",
  childTitle: "{heading}",
  childBody: "{heading}\n{body}",
  parentPageName: "",
  tag: "",
  createParentLinks: true,
  stripBlankLines: false,
};

class Plugin extends AppPlugin {
  onLoad() {
    this._tagsPropGuid = null;
    this.injectClipperCSS();

    this.ui.registerCustomPanelType(CLIPPER_SETTINGS_PANEL_ID, (panel) => {
      const el = panel.getElement();
      if (el) void this.renderClipperSettingsPanel(panel, el);
    });

    this.ui.addCommandPaletteCommand({
      label: "ClipParser: Create record from clipboard",
      icon: "clipboard-text",
      onSelected: () => {
        this.clipFromClipboard().catch((err) => {
          this.ui.addToaster({
            title: "Clipboard clip failed",
            message: err && err.message ? err.message : String(err),
            dismissible: true,
            autoDestroyTime: 7000,
          });
        });
      },
    });

    this.ui.addCommandPaletteCommand({
      label: "ClipParser: Settings",
      icon: "settings",
      onSelected: () => {
        this.openClipperSettings().catch((err) => {
          this.ui.addToaster({
            title: "Could not open settings",
            message: err && err.message ? err.message : String(err),
            dismissible: true,
            autoDestroyTime: 7000,
          });
        });
      },
    });

    this.ui.addCommandPaletteCommand({
      label: "ClipParser: Run saved parser profile...",
      icon: "check",
      onSelected: () => {
        this.runSavedParserProfileFromPrompt().catch((err) => {
          this.ui.addToaster({
            title: "Saved parser failed",
            message: err && err.message ? err.message : String(err),
            dismissible: true,
            autoDestroyTime: 8000,
          });
        });
      },
    });

  }

  injectClipperCSS() {
    const css =
      ".clip-root{width:100%;max-width:860px;box-sizing:border-box;padding:16px 0 32px;color:inherit}" +
      ".clip-header{margin:0 0 14px 0}" +
      ".clip-title{font-size:16px;font-weight:600;margin:0 0 6px 0}" +
      ".clip-copy,.clip-help{font-size:13px;line-height:1.45;opacity:.68;margin:0 0 12px 0}" +
      ".clip-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px 0;padding:2px;background:var(--input-bg-color);border:1px solid var(--input-border-color);border-radius:var(--ed-radius-block)}" +
      ".clip-tab{background:none;border:none;color:inherit;cursor:pointer;border-radius:var(--ed-radius-normal);font-size:13px;padding:7px 12px;opacity:.58;transition:opacity .12s,background .12s,color .12s}" +
      ".clip-tab:hover{opacity:.9;background:var(--cards-hover-bg)}" +
      ".clip-tab--active{opacity:1;background:var(--cards-bg);font-weight:600;color:var(--ed-link-color)}" +
      ".clip-card{background:var(--cards-bg);border:1px solid var(--ed-container-border-color);border-radius:var(--ed-radius-block);box-shadow:none;padding:14px;margin:0 0 14px 0;box-sizing:border-box}" +
      ".clip-profile-layout .clip-card{margin:0}" +
      ".clip-section-title{font-size:13px;font-weight:600;opacity:.58;margin:0 0 10px 0;padding:0 0 6px 0;border-bottom:1px solid var(--sidebar-border-color)}" +
      ".clip-profile-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:0}" +
      ".clip-field{display:block;margin:0 0 12px 0}" +
      ".clip-label{font-size:12px;font-weight:600;opacity:.58;margin:0 0 5px 0}" +
      ".clip-input{width:100%;box-sizing:border-box;background:var(--input-bg-color);border:1px solid var(--input-border-color);border-radius:var(--ed-radius-normal);color:inherit;font-size:13px;padding:8px 10px;outline:none;transition:border-color .12s,background .12s}" +
      ".clip-input:focus{border-color:var(--ed-link-color)}" +
      "textarea.clip-input{resize:vertical;line-height:1.4;font-family:inherit}" +
      ".clip-check{display:flex;align-items:center;gap:8px;margin:0 0 12px 0;font-size:13px;opacity:.82}" +
      ".clip-check input{flex-shrink:0}" +
      ".clip-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px 0}" +
      ".clip-actions button{border-radius:var(--ed-radius-normal);font-size:13px}" +
      ".clip-btn-primary{font-weight:600}" +
      ".clip-btn-quiet{opacity:.82}" +
      ".clip-footer{margin-top:12px;padding-top:2px}" +
      ".clip-summary{font-size:12px;line-height:1.35;opacity:.58;margin:0 0 12px 0}" +
      ".clip-preview{white-space:pre-wrap;padding:10px;border:1px solid var(--ed-container-border-color);border-radius:var(--ed-radius-block);background:var(--input-bg-color);min-height:100px;max-height:260px;overflow:auto;margin:0 0 12px 0;font-size:12px;line-height:1.45;color:inherit}" +
      ".clip-dialog-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}" +
      ".clip-dialog{position:relative;max-width:480px;width:100%;max-height:min(85vh,560px);overflow:auto;background:var(--cards-bg);border:1px solid var(--cards-border-color);border-radius:var(--ed-radius-block);padding:18px 40px 18px 18px;box-shadow:0 8px 32px rgba(0,0,0,.4);box-sizing:border-box}" +
      ".clip-dialog-close{position:absolute;top:8px;right:8px;z-index:1;width:32px;height:32px;border:none;border-radius:var(--ed-radius-normal);background:transparent;color:inherit;cursor:pointer;font-size:18px;line-height:1;opacity:.75}" +
      ".clip-dialog-close:hover{opacity:1;background:var(--cards-hover-bg)}" +
      ".clip-dialog-title{font-size:16px;font-weight:600;margin:0 0 4px 0}" +
      ".clip-dialog-body{margin:12px 0 0 0}" +
      ".clip-dialog .clip-preview{max-height:220px}" +
      ".clip-dialog-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin:14px 0 0 0}" +
      ".clip-dialog-btn{background:color-mix(in srgb,var(--cards-bg) 70%, var(--input-bg-color) 30%);border:2px solid color-mix(in srgb,var(--sidebar-border-color) 60%, var(--input-text-color,#ffffff) 40%);color:inherit;cursor:pointer;font-size:13px;font-weight:600;padding:7px 12px;border-radius:var(--ed-radius-normal);box-shadow:0 2px 6px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.08);transition:background .1s,border-color .1s,box-shadow .1s,transform .05s}" +
      ".clip-dialog-btn:hover{background:color-mix(in srgb,var(--cards-hover-bg) 55%, var(--input-bg-color) 45%);border-color:color-mix(in srgb,var(--sidebar-border-color) 42%, var(--input-text-color,#ffffff) 58%);box-shadow:0 4px 10px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.1)}" +
      ".clip-dialog-btn:active{transform:translateY(1px);box-shadow:0 2px 4px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.06)}" +
      ".clip-dialog-btn:focus-visible{outline:2px solid var(--ed-button-primary-bg,#4c8dff);outline-offset:2px}" +
      ".clip-dialog-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}" +
      ".clip-dialog-btn--secondary{background:color-mix(in srgb,var(--cards-bg) 78%, var(--input-bg-color) 22%)}" +
      "@media(min-width:760px){.clip-profile-layout{grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:14px}.clip-profile-layout>.clip-span-all{grid-column:1 / -1}}" +
      "@media(max-width:600px){.clip-root{padding:12px 0}.clip-card{padding:12px}.clip-tabs{display:grid;grid-template-columns:1fr 1fr}.clip-tab{width:100%}}";

    if (typeof document !== "undefined" && document.head) {
      if (document.getElementById("thymer-clipper-css")) return;
      const style = document.createElement("style");
      style.id = "thymer-clipper-css";
      style.textContent = css;
      document.head.appendChild(style);
      return;
    }

    if (this.ui && typeof this.ui.injectCSS === "function") this.ui.injectCSS(css);
  }

  /**
   * Uses a native browser prompt to collect the title.
   * Returns null when the user cancels.
   */
  async promptUserForClipTitle(suggestion) {
    const answer = window.prompt("Title for new clip", suggestion || "");
    if (answer === null) return null;
    const trimmed = answer.trim();
    if (trimmed) return trimmed.slice(0, 240);
    const fallback = (suggestion || "").trim();
    if (fallback) return fallback.slice(0, 240);
    return "Untitled clip";
  }

  async openClipperSettings() {
    const panel = await this.ui.createPanel();
    if (!panel) {
      this.ui.addToaster({
        title: "Could not open panel",
        dismissible: true,
        autoDestroyTime: 4000,
      });
      return;
    }
    panel.setTitle("Clipboard Parser");
    panel.navigateToCustomType(CLIPPER_SETTINGS_PANEL_ID);
  }

  async renderClipperSettingsPanel(panel, container) {
    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "clip-root";
    wrap.style.padding = "16px";
    wrap.style.maxWidth = "820px";
    wrap.style.boxSizing = "border-box";

    const header = document.createElement("div");
    header.className = "clip-header";

    const heading = document.createElement("div");
    heading.className = "clip-title";
    heading.textContent = "Clipboard Parser settings";
    heading.style.fontWeight = "600";
    heading.style.fontSize = "16px";
    heading.style.marginBottom = "8px";

    const blurb = document.createElement("p");
    blurb.className = "clip-copy";
    blurb.textContent =
      "Configure the default clip destination and saved parser profiles used by clipboard parse commands.";
    blurb.style.margin = "0 0 12px 0";
    blurb.style.lineHeight = "1.45";
    blurb.style.opacity = "0.9";
    header.appendChild(heading);
    header.appendChild(blurb);

    const tabs = document.createElement("div");
    tabs.className = "clip-tabs";
    tabs.style.display = "flex";
    tabs.style.gap = "8px";
    tabs.style.margin = "0 0 12px 0";
    tabs.style.flexWrap = "wrap";

    let activeSettingsTab = "general";
    const generalTabBtn = this.ui.createButton({
      icon: "settings",
      label: "General",
      onClick: () => setSettingsTab("general"),
    });
    if (generalTabBtn.classList) generalTabBtn.classList.add("clip-tab");
    const profilesTabBtn = this.ui.createButton({
      icon: "split",
      label: "Parser Profiles",
      onClick: () => setSettingsTab("profiles"),
    });
    if (profilesTabBtn.classList) profilesTabBtn.classList.add("clip-tab");
    tabs.appendChild(generalTabBtn);
    tabs.appendChild(profilesTabBtn);

    const generalCard = this.createSettingsCard("General");
    const generalHelp = document.createElement("p");
    generalHelp.className = "clip-help";
    generalHelp.textContent =
      "When set, new clips always go to this collection. When unset, the parser uses whichever non-journal collection is open in the focused panel.";
    generalHelp.style.margin = "0 0 12px 0";
    generalHelp.style.lineHeight = "1.45";
    generalHelp.style.opacity = "0.9";

    const select = document.createElement("select");
    select.className = "clip-input";
    select.style.width = "100%";
    select.style.padding = "8px";
    select.style.boxSizing = "border-box";

    const currentRaw = ((this.getConfiguration().custom || {}).target_collection_name || "").trim();
    const currentLower = currentRaw.toLowerCase();

    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "— None (use open panel) —";
    if (!currentRaw) optNone.selected = true;
    select.appendChild(optNone);

    const collections = await this.data.getAllCollections();
    let matched = false;
    for (const c of collections) {
      if (typeof c.isJournalPlugin === "function" && c.isJournalPlugin()) continue;
      const name = c.getName();
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (currentRaw && name.trim().toLowerCase() === currentLower) {
        opt.selected = true;
        matched = true;
      }
      select.appendChild(opt);
    }

    if (currentRaw && !matched) {
      const opt = document.createElement("option");
      opt.value = currentRaw;
      opt.textContent = `${currentRaw} (no matching collection)`;
      opt.selected = true;
      select.appendChild(opt);
    }

    generalCard.body.appendChild(generalHelp);
    generalCard.body.appendChild(select);

    const profilesCard = this.createSettingsCard("Parser profiles");
    const profilesHelp = document.createElement("p");
    profilesHelp.className = "clip-help";
    profilesHelp.textContent =
      "Saved profiles define reusable parsing rules. The parse commands can load these profiles, preview clipboard output, and create records.";
    profilesHelp.style.margin = "0 0 12px 0";
    profilesHelp.style.lineHeight = "1.45";
    profilesHelp.style.opacity = "0.9";
    profilesCard.body.appendChild(profilesHelp);

    let profiles = normalizeParserProfiles((this.getConfiguration().custom || {}).parser_profiles);
    let selectedProfileIndex = profiles.length ? 0 : null;

    const profileSummary = document.createElement("div");
    profileSummary.className = "clip-summary";
    profileSummary.style.margin = "0 0 12px 0";
    profileSummary.style.opacity = "0.85";

    const controls = {};
    controls.profile = this.createLabeledSelect("Saved profile", []);
    controls.name = this.createLabeledInput("Profile name", "Example Markdown Headings");
    controls.mode = this.createLabeledSelect("Parse mode", [
      { value: "onePage", label: "One page" },
      { value: "delimiterSections", label: "Split by delimiter" },
      { value: "weekdaySections", label: "Weekday sections" },
      { value: "regexSections", label: "Split by regex heading" },
    ]);
    controls.parentTitle = this.createLabeledInput("Parent/page title", "Parsed clipboard");
    controls.parentTitlePrefix = this.createLabeledInput("Weekday parent title prefix", "Clipboard Week");
    controls.delimiter = this.createLabeledInput("Delimiter", "---");
    controls.sectionStartRegex = this.createLabeledInput("Section heading regex", "^#{1,6}\\s+(.+)$");
    controls.childTitle = this.createLabeledInput("Child title template", "{heading}");
    controls.childBody = this.createLabeledTextarea("Child body template", "{heading}\n{body}", 4);
    controls.parentPageName = this.createLabeledInput("Put parent under existing page", "Optional page name");
    controls.tag = this.createLabeledInput("Tag to apply", "#wellness");

    const sampleField = this.createLabeledTextarea("Sample clipboard data", "Paste sample text here to preview this profile.", 8);
    const projectedPreview = document.createElement("pre");
    projectedPreview.className = "clip-preview";
    projectedPreview.style.whiteSpace = "pre-wrap";
    projectedPreview.style.padding = "10px";
    projectedPreview.style.border = "1px solid rgba(128,128,128,0.35)";
    projectedPreview.style.borderRadius = "6px";
    projectedPreview.style.minHeight = "100px";
    projectedPreview.style.maxHeight = "260px";
    projectedPreview.style.overflow = "auto";
    projectedPreview.style.margin = "0 0 12px 0";

    const linksLabel = this.createCheckboxField("Create links from the parent page to child pages", true);
    controls.createParentLinks = linksLabel.input;
    const stripBlankLinesLabel = this.createCheckboxField("Strip blank lines from generated page bodies", false);
    controls.stripBlankLines = stripBlankLinesLabel.input;

    const profileActions = document.createElement("div");
    profileActions.className = "clip-actions";
    profileActions.style.display = "flex";
    profileActions.style.gap = "8px";
    profileActions.style.alignItems = "center";
    profileActions.style.flexWrap = "wrap";
    profileActions.style.margin = "0 0 12px 0";

    const profileFromControls = () => {
      const spec = normalizeParseSpec({
        name: controls.name.input.value,
        mode: controls.mode.input.value,
        parentTitle: controls.parentTitle.input.value,
        parentTitlePrefix: controls.parentTitlePrefix.input.value,
        delimiter: controls.delimiter.input.value,
        sectionStartRegex: controls.sectionStartRegex.input.value,
        childTitle: controls.childTitle.input.value,
        childBody: controls.childBody.input.value,
        parentPageName: controls.parentPageName.input.value,
        tag: controls.tag.input.value,
        createParentLinks: controls.createParentLinks.checked,
        stripBlankLines: controls.stripBlankLines.checked,
      });
      spec.name = (controls.name.input.value || "").trim();
      return spec;
    };

    const applyProfileToControls = (profile) => {
      const next = normalizeParseSpec(profile || DEFAULT_PARSE_SPEC);
      controls.name.input.value = next.name;
      controls.mode.input.value = next.mode;
      controls.parentTitle.input.value = next.parentTitle;
      controls.parentTitlePrefix.input.value = next.parentTitlePrefix;
      controls.delimiter.input.value = next.delimiter;
      controls.sectionStartRegex.input.value = next.sectionStartRegex;
      controls.childTitle.input.value = next.childTitle;
      controls.childBody.input.value = next.childBody;
      controls.parentPageName.input.value = next.parentPageName;
      controls.tag.input.value = next.tag;
      controls.createParentLinks.checked = next.createParentLinks !== false;
      controls.stripBlankLines.checked = next.stripBlankLines === true;
    };

    const refreshProfileOptions = () => {
      controls.profile.input.innerHTML = "";
      profiles.forEach((profile, index) => {
        const opt = document.createElement("option");
        opt.value = String(index);
        opt.textContent = profile.name || `Profile ${index + 1}`;
        controls.profile.input.appendChild(opt);
      });

      if (!profiles.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No saved profiles";
        controls.profile.input.appendChild(opt);
        controls.profile.input.disabled = true;
        selectedProfileIndex = null;
      } else {
        controls.profile.input.disabled = false;
        if (selectedProfileIndex == null || selectedProfileIndex >= profiles.length) selectedProfileIndex = 0;
        controls.profile.input.value = String(selectedProfileIndex);
      }
    };

    const refreshProfileVisibility = () => {
      const mode = controls.mode.input.value;
      controls.delimiter.wrap.style.display = mode === "delimiterSections" ? "block" : "none";
      controls.sectionStartRegex.wrap.style.display = mode === "regexSections" ? "block" : "none";
      controls.parentTitlePrefix.wrap.style.display = mode === "weekdaySections" ? "block" : "none";
      const splitMode = mode !== "onePage";
      controls.childTitle.wrap.style.display = splitMode ? "block" : "none";
      controls.childBody.wrap.style.display = splitMode ? "block" : "none";
      linksLabel.wrap.style.display = splitMode ? "flex" : "none";
      stripBlankLinesLabel.wrap.style.display = splitMode ? "flex" : "none";
    };

    const refreshProfileSummary = () => {
      if (selectedProfileIndex == null || !profiles[selectedProfileIndex]) {
        profileSummary.textContent = "Create a profile to make it available in parse commands.";
        return;
      }
      const profile = normalizeParseSpec(profiles[selectedProfileIndex]);
      const bits = [profile.mode];
      if (profile.tag) bits.push(profile.tag);
      if (profile.parentPageName) bits.push(`under ${profile.parentPageName}`);
      if (profile.stripBlankLines) bits.push("strips blank lines");
      profileSummary.textContent = bits.join(" · ");
    };

    const refreshSettingsPreview = () => {
      const sample = (sampleField.input.value || "").trim();
      if (!sample) {
        projectedPreview.textContent = "Paste sample clipboard data to preview this profile.";
        return;
      }
      try {
        const parsePlan = buildParsePlan(sample, profileFromControls());
        projectedPreview.textContent = formatParsePreview(parsePlan);
      } catch (err) {
        projectedPreview.textContent = err && err.message ? err.message : String(err);
      }
    };

    const selectProfile = (index) => {
      selectedProfileIndex = index;
      refreshProfileOptions();
      applyProfileToControls(index == null ? DEFAULT_PARSE_SPEC : profiles[index]);
      refreshProfileVisibility();
      refreshProfileSummary();
      refreshSettingsPreview();
    };

    const newProfileBtn = this.ui.createButton({
      icon: "plus",
      label: "New",
      onClick: () => {
        profiles.push({ ...DEFAULT_PARSE_SPEC, name: "New parser profile" });
        selectProfile(profiles.length - 1);
      },
    });

    const duplicateProfileBtn = this.ui.createButton({
      icon: "copy",
      label: "Duplicate",
      onClick: () => {
        const base = selectedProfileIndex == null ? profileFromControls() : profiles[selectedProfileIndex];
        const clone = { ...normalizeParseSpec(base), name: `${(base && base.name) || "Parser profile"} copy` };
        profiles.push(clone);
        selectProfile(profiles.length - 1);
      },
    });

    const deleteProfileBtn = this.ui.createButton({
      icon: "trash",
      label: "Delete",
      onClick: () => {
        if (selectedProfileIndex == null || !profiles[selectedProfileIndex]) return;
        const name = profiles[selectedProfileIndex].name || `Profile ${selectedProfileIndex + 1}`;
        if (!window.confirm(`Delete parser profile "${name}"?`)) return;
        profiles.splice(selectedProfileIndex, 1);
        selectProfile(profiles.length ? Math.min(selectedProfileIndex, profiles.length - 1) : null);
      },
    });

    profileActions.appendChild(newProfileBtn);
    profileActions.appendChild(duplicateProfileBtn);
    profileActions.appendChild(deleteProfileBtn);

    const profileLayout = document.createElement("div");
    profileLayout.className = "clip-profile-layout";
    const profileDetails = this.createSettingsCard("Profile");
    const outputRules = this.createSettingsCard("Output");
    const testCard = this.createSettingsCard("Test");
    testCard.wrap.classList.add("clip-span-all");

    controls.profile.input.addEventListener("change", () => {
      const index = Number(controls.profile.input.value);
      selectProfile(Number.isFinite(index) ? index : null);
    });

    const updateSelectedProfileFromControls = () => {
      if (selectedProfileIndex != null && profiles[selectedProfileIndex]) {
        profiles[selectedProfileIndex] = profileFromControls();
        refreshProfileOptions();
      }
      refreshProfileVisibility();
      refreshProfileSummary();
      refreshSettingsPreview();
    };

    for (const key of Object.keys(controls)) {
      const ctl = controls[key];
      if (!ctl || !ctl.input || key === "profile") continue;
      ctl.input.addEventListener("input", updateSelectedProfileFromControls);
      ctl.input.addEventListener("change", updateSelectedProfileFromControls);
    }
    controls.createParentLinks.addEventListener("change", updateSelectedProfileFromControls);
    controls.stripBlankLines.addEventListener("change", updateSelectedProfileFromControls);
    sampleField.input.addEventListener("input", refreshSettingsPreview);
    sampleField.input.addEventListener("change", refreshSettingsPreview);

    refreshProfileOptions();
    applyProfileToControls(selectedProfileIndex == null ? DEFAULT_PARSE_SPEC : profiles[selectedProfileIndex]);
    refreshProfileVisibility();
    refreshProfileSummary();
    refreshSettingsPreview();

    profilesCard.body.appendChild(controls.profile.wrap);
    profilesCard.body.appendChild(profileActions);
    profilesCard.body.appendChild(profileSummary);
    profileDetails.body.appendChild(controls.name.wrap);
    profileDetails.body.appendChild(controls.mode.wrap);
    profileDetails.body.appendChild(controls.parentPageName.wrap);
    profileDetails.body.appendChild(controls.tag.wrap);
    outputRules.body.appendChild(controls.parentTitle.wrap);
    outputRules.body.appendChild(controls.parentTitlePrefix.wrap);
    outputRules.body.appendChild(controls.delimiter.wrap);
    outputRules.body.appendChild(controls.sectionStartRegex.wrap);
    outputRules.body.appendChild(controls.childTitle.wrap);
    outputRules.body.appendChild(controls.childBody.wrap);
    outputRules.body.appendChild(stripBlankLinesLabel.wrap);
    outputRules.body.appendChild(linksLabel.wrap);
    testCard.body.appendChild(sampleField.wrap);
    testCard.body.appendChild(projectedPreview);
    profileLayout.appendChild(profileDetails.wrap);
    profileLayout.appendChild(outputRules.wrap);
    profileLayout.appendChild(testCard.wrap);
    profilesCard.body.appendChild(profileLayout);

    const row = document.createElement("div");
    row.className = "clip-actions clip-footer";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.marginTop = "12px";

    const saveBtn = this.ui.createButton({
      icon: "check",
      label: "Save settings",
      onClick: async () => {
        try {
          if (selectedProfileIndex != null && profiles[selectedProfileIndex]) {
            profiles[selectedProfileIndex] = profileFromControls();
          }
          const value = select.value;
          await this.persistClipperSettings(value, profiles);
          this.ui.addToaster({
            title: "Clipboard Parser settings saved",
            message: value.trim()
              ? `Clips go to "${value.trim()}". ${profiles.length} parser profile${profiles.length === 1 ? "" : "s"} saved.`
              : `Clips use whichever collection is open in the focused panel. ${profiles.length} parser profile${profiles.length === 1 ? "" : "s"} saved.`,
            dismissible: true,
            autoDestroyTime: 4000,
          });
          this.ui.closePanel(panel);
        } catch (err) {
          this.ui.addToaster({
            title: "Save failed",
            message: err && err.message ? err.message : String(err),
            dismissible: true,
            autoDestroyTime: 7000,
          });
        }
      },
    });
    if (saveBtn.classList) saveBtn.classList.add("clip-btn", "clip-btn-primary");

    const cancelBtn = this.ui.createButton({
      icon: "x",
      label: "Close",
      onClick: () => this.ui.closePanel(panel),
    });
    if (cancelBtn.classList) cancelBtn.classList.add("clip-btn", "clip-btn-quiet");

    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);

    const setSettingsTab = (tab) => {
      activeSettingsTab = tab;
      generalCard.wrap.style.display = activeSettingsTab === "general" ? "block" : "none";
      profilesCard.wrap.style.display = activeSettingsTab === "profiles" ? "block" : "none";
      if (generalTabBtn.style) generalTabBtn.style.fontWeight = activeSettingsTab === "general" ? "600" : "400";
      if (profilesTabBtn.style) profilesTabBtn.style.fontWeight = activeSettingsTab === "profiles" ? "600" : "400";
      if (generalTabBtn.classList) generalTabBtn.classList.toggle("clip-tab--active", activeSettingsTab === "general");
      if (profilesTabBtn.classList) profilesTabBtn.classList.toggle("clip-tab--active", activeSettingsTab === "profiles");
    };

    wrap.appendChild(header);
    wrap.appendChild(tabs);
    wrap.appendChild(generalCard.wrap);
    wrap.appendChild(profilesCard.wrap);
    wrap.appendChild(row);
    container.appendChild(wrap);
    setSettingsTab(activeSettingsTab);
  }

  createSettingsCard(title) {
    const card = document.createElement("section");
    card.className = "clip-card";
    card.style.border = "1px solid rgba(128,128,128,0.28)";
    card.style.borderRadius = "8px";
    card.style.padding = "14px";
    card.style.margin = "0 0 14px 0";
    card.style.boxSizing = "border-box";

    const heading = document.createElement("div");
    heading.className = "clip-section-title";
    heading.textContent = title;
    heading.style.fontWeight = "600";
    heading.style.fontSize = "15px";
    heading.style.marginBottom = "8px";

    const body = document.createElement("div");
    card.appendChild(heading);
    card.appendChild(body);
    return { wrap: card, body };
  }

  async persistTargetCollectionName(name) {
    const conf = clonePluginConfiguration(this.getConfiguration());
    conf.custom = conf.custom || {};
    conf.custom.target_collection_name = (name || "").trim();

    const api = this.data.getPluginByGuid(this.getGuid());
    if (!api || typeof api.saveConfiguration !== "function") {
      throw new Error("Cannot save configuration for this plugin (missing save API).");
    }
    await api.saveConfiguration(conf);
  }

  async persistParserProfiles(profiles) {
    const conf = clonePluginConfiguration(this.getConfiguration());
    conf.custom = conf.custom || {};
    conf.custom.parser_profiles = normalizeParserProfiles(profiles);

    const api = this.data.getPluginByGuid(this.getGuid());
    if (!api || typeof api.saveConfiguration !== "function") {
      throw new Error("Cannot save configuration for this plugin (missing save API).");
    }
    await api.saveConfiguration(conf);
  }

  async persistClipperSettings(targetCollectionName, profiles) {
    const conf = clonePluginConfiguration(this.getConfiguration());
    conf.custom = conf.custom || {};
    conf.custom.target_collection_name = (targetCollectionName || "").trim();
    conf.custom.parser_profiles = normalizeParserProfiles(profiles);

    const api = this.data.getPluginByGuid(this.getGuid());
    if (!api || typeof api.saveConfiguration !== "function") {
      throw new Error("Cannot save configuration for this plugin (missing save API).");
    }
    await api.saveConfiguration(conf);
  }

  createLabeledInput(labelText, placeholder) {
    const wrap = this.createFieldWrap(labelText);
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder || "";
    this.applyFieldStyle(input);
    wrap.appendChild(input);
    return { wrap, input };
  }

  createLabeledTextarea(labelText, placeholder, rows) {
    const wrap = this.createFieldWrap(labelText);
    const input = document.createElement("textarea");
    input.placeholder = placeholder || "";
    input.rows = rows || 3;
    this.applyFieldStyle(input);
    wrap.appendChild(input);
    return { wrap, input };
  }

  createLabeledSelect(labelText, options) {
    const wrap = this.createFieldWrap(labelText);
    const input = document.createElement("select");
    this.applyFieldStyle(input);
    for (const option of options) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      input.appendChild(opt);
    }
    wrap.appendChild(input);
    return { wrap, input };
  }

  createCheckboxField(labelText, checked) {
    const wrap = document.createElement("label");
    wrap.className = "clip-check";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";
    wrap.style.alignItems = "center";
    wrap.style.margin = "0 0 12px 0";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked === true;
    const text = document.createElement("span");
    text.textContent = labelText;
    wrap.appendChild(input);
    wrap.appendChild(text);
    return { wrap, input };
  }

  createFieldWrap(labelText) {
    const wrap = document.createElement("label");
    wrap.className = "clip-field";
    wrap.style.display = "block";
    wrap.style.marginBottom = "12px";
    const text = document.createElement("div");
    text.className = "clip-label";
    text.textContent = labelText;
    text.style.fontWeight = "600";
    text.style.marginBottom = "4px";
    wrap.appendChild(text);
    return wrap;
  }

  applyFieldStyle(input) {
    input.classList.add("clip-input");
    input.style.width = "100%";
    input.style.padding = "8px";
    input.style.boxSizing = "border-box";
  }

  async readClipboardOrToastWhenEmpty() {
    const clipboard = await readClipboard();
    if (clipboardHasData(clipboard)) return clipboard;
    this.ui.addToaster({
      title: "Clipboard is empty",
      message: "Copy data to the clipboard and try again.",
      dismissible: true,
      autoDestroyTime: 5000,
    });
    return null;
  }

  async clipFromClipboard() {
    const { collection, hint } = await this.resolveTargetCollection();
    if (!collection) {
      this.ui.addToaster({
        title: "No target collection",
        message: hint,
        dismissible: true,
        autoDestroyTime: 9000,
      });
      return;
    }

    if (collection.isJournalPlugin()) {
      this.ui.addToaster({
        title: "Pick a non-journal collection",
        message:
          'Clips cannot be created in a journal. Open a different collection or run "Clipboard Parser settings" to pick a default.',
        dismissible: true,
        autoDestroyTime: 8000,
      });
      return;
    }

    const clipboard = await this.readClipboardOrToastWhenEmpty();
    if (!clipboard) return;
    const { plain, html, images } = clipboard;
    const trimmedPlain = (plain || "").trim();
    const htmlTrim = (html || "").trim();

    const suggestion = pickRecordTitle(trimmedPlain, images.length > 0 && !trimmedPlain && !htmlTrim);
    const titleOrNull = await this.promptUserForClipTitle(suggestion);
    if (titleOrNull === null) {
      this.ui.addToaster({
        title: "Clip cancelled",
        dismissible: true,
        autoDestroyTime: 2500,
      });
      return;
    }
    const title = (titleOrNull || "").trim() || suggestion;

    const guid = collection.createRecord(title);
    if (!guid) {
      this.ui.addToaster({
        title: "Could not create record",
        dismissible: true,
        autoDestroyTime: 5000,
      });
      return;
    }

    const record = await this.resolveRecordAfterCreate(collection, guid);
    if (!record) {
      this.ui.addToaster({
        title: "Record created but not ready yet",
        message:
          "Thymer returned a new page id, but the plugin store had not loaded that page yet. Open the target collection and run the command again, or wait a moment.",
        dismissible: true,
        autoDestroyTime: 8000,
      });
      return;
    }

    if (htmlTrim) {
      await record.insertFromHTML(htmlTrim, null, null);
    } else if (trimmedPlain) {
      await record.insertFromPlainText(trimmedPlain || plain, null, null);
    }

    await this.appendClipboardImages(record, images);

    this.navigateToRecord(guid);

    this.ui.addToaster({
      title: "Clip saved",
      message: `${title} → ${collection.getName()}`,
      dismissible: true,
      autoDestroyTime: 3500,
    });
  }

  async runSavedParserProfileFromPrompt() {
    const profiles = normalizeParserProfiles((this.getConfiguration().custom || {}).parser_profiles);
    if (!profiles.length) {
      this.ui.addToaster({
        title: "No saved parser profiles",
        message: "Add profiles in plugin.json or save one from the parser panel.",
        dismissible: true,
        autoDestroyTime: 7000,
      });
      return;
    }

    const profile = await this.promptForParserProfileDialog(profiles);
    if (!profile) {
      this.ui.addToaster({
        title: "Parser cancelled",
        dismissible: true,
        autoDestroyTime: 2500,
      });
      return;
    }

    const clipboard = await this.readClipboardOrToastWhenEmpty();
    if (!clipboard) return;
    const { plain, html } = clipboard;
    const source = (plain || "").trim() || htmlToPlainText(html || "").trim();
    const parsePlan = buildParsePlan(source, profile);
    if (!(await this.confirmParsePlanDialog(profile, parsePlan))) {
      this.ui.addToaster({
        title: "Parser cancelled",
        dismissible: true,
        autoDestroyTime: 2500,
      });
      return;
    }

    const { collection, hint } = await this.resolveTargetCollection();
    if (!collection) throw new Error(hint);
    if (collection.isJournalPlugin()) throw new Error("Parsed clips cannot be created in a journal collection.");

    const stage1 = await this.createParsedRecordsExceptLinks(collection, parsePlan);
    this.navigateToRecord(stage1.parentGuid);
    this.ui.addToaster({
      title: "Saved parser ran",
      message: stage1.createdChildren.length
        ? `${stage1.createdChildren.length} pages created under ${stage1.title}.`
        : `${stage1.title} created in ${collection.getName()}.`,
      dismissible: true,
      autoDestroyTime: 6000,
    });

    this.createParentLinksInBackground(stage1.parentRecord, stage1.createdChildren, parsePlan);
  }

  promptForParserProfileDialog(profiles) {
    return new Promise((resolve) => {
      const normalizedProfiles = normalizeParserProfiles(profiles);
      if (!normalizedProfiles.length) {
        resolve(null);
        return;
      }

      const body = document.createElement("div");
      const field = this.createLabeledSelect(
        "Saved parser profile",
        normalizedProfiles.map((profile, index) => ({
          value: String(index),
          label: profile.name || `Profile ${index + 1}`,
        }))
      );
      const summary = document.createElement("div");
      summary.className = "clip-summary";

      const refresh = () => {
        const profile = normalizeParseSpec(normalizedProfiles[Number(field.input.value)] || normalizedProfiles[0]);
        const bits = [profile.mode];
        if (profile.tag) bits.push(profile.tag);
        if (profile.parentPageName) bits.push(`under ${profile.parentPageName}`);
        if (profile.stripBlankLines) bits.push("strips blank lines");
        summary.textContent = bits.join(" · ");
      };

      field.input.addEventListener("change", refresh);
      refresh();
      body.appendChild(field.wrap);
      body.appendChild(summary);

      this.showClipperDialog({
        title: "Run saved parser profile",
        message: "Choose a parser profile to run against the current clipboard.",
        body,
        primaryLabel: "Preview",
        onPrimary: () => resolve(normalizedProfiles[Number(field.input.value)] || null),
        onCancel: () => resolve(null),
      });
    });
  }

  confirmParsePlanDialog(profile, parsePlan) {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      const summary = document.createElement("p");
      summary.className = "clip-copy";
      summary.textContent = parsePlan.children.length
        ? `${parsePlan.children.length} page${parsePlan.children.length === 1 ? "" : "s"} will be created under "${parsePlan.parentTitle}".`
        : `"${parsePlan.parentTitle}" will be created as a single page.`;

      const preview = document.createElement("pre");
      preview.className = "clip-preview";
      preview.textContent = formatParsePreview(parsePlan);

      body.appendChild(summary);
      body.appendChild(preview);

      this.showClipperDialog({
        title: profile.name ? `Run ${profile.name}?` : "Run parser profile?",
        message: "Review the projected output before records are created.",
        body,
        primaryLabel: "Create records",
        onPrimary: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  showClipperDialog(options) {
    const opts = options || {};
    const overlay = document.createElement("div");
    overlay.className = "clip-dialog-overlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "200";
    overlay.style.background = "rgba(0,0,0,.42)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "20px";
    overlay.style.boxSizing = "border-box";

    const dialog = document.createElement("div");
    dialog.className = "clip-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.style.position = "relative";
    dialog.style.maxWidth = "480px";
    dialog.style.width = "100%";
    dialog.style.maxHeight = "min(85vh,560px)";
    dialog.style.overflow = "auto";
    dialog.style.background = "var(--cards-bg)";
    dialog.style.border = "1px solid var(--cards-border-color)";
    dialog.style.borderRadius = "var(--ed-radius-block)";
    dialog.style.padding = "18px 40px 18px 18px";
    dialog.style.boxShadow = "0 8px 32px rgba(0,0,0,.4)";
    dialog.style.boxSizing = "border-box";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "clip-dialog-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "x";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "8px";
    closeBtn.style.right = "8px";
    closeBtn.style.width = "32px";
    closeBtn.style.height = "32px";
    closeBtn.style.border = "none";
    closeBtn.style.borderRadius = "var(--ed-radius-normal)";
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "inherit";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "18px";
    closeBtn.style.lineHeight = "1";
    closeBtn.style.opacity = ".75";

    const title = document.createElement("p");
    title.className = "clip-dialog-title";
    title.textContent = opts.title || "Clipboard Parser";
    title.style.fontSize = "16px";
    title.style.fontWeight = "600";
    title.style.margin = "0 0 4px 0";
    const titleId = `clip-dialog-title-${Date.now()}`;
    title.id = titleId;
    dialog.setAttribute("aria-labelledby", titleId);

    const message = document.createElement("p");
    message.className = "clip-copy";
    message.textContent = opts.message || "";

    const body = document.createElement("div");
    body.className = "clip-dialog-body";
    body.style.margin = "12px 0 0 0";
    if (opts.body) body.appendChild(opts.body);

    const actions = document.createElement("div");
    actions.className = "clip-dialog-actions";
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.alignItems = "center";
    actions.style.justifyContent = "flex-end";
    actions.style.flexWrap = "wrap";
    actions.style.margin = "14px 0 0 0";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "clip-dialog-btn clip-dialog-btn--secondary";
    cancelBtn.textContent = opts.cancelLabel || "Cancel";
    this.applyDialogButtonStyle(cancelBtn);

    const primaryBtn = document.createElement("button");
    primaryBtn.type = "button";
    primaryBtn.className = "clip-dialog-btn";
    primaryBtn.textContent = opts.primaryLabel || "OK";
    primaryBtn.disabled = opts.primaryDisabled === true;
    this.applyDialogButtonStyle(primaryBtn);

    actions.appendChild(cancelBtn);
    actions.appendChild(primaryBtn);
    dialog.appendChild(closeBtn);
    dialog.appendChild(title);
    if (message.textContent) dialog.appendChild(message);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    let settled = false;
    const cleanup = (didPrimary) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      if (didPrimary) opts.onPrimary && opts.onPrimary();
      else opts.onCancel && opts.onCancel();
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") cleanup(false);
      if (event.key === "Enter" && !primaryBtn.disabled) cleanup(true);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(false);
    });
    closeBtn.addEventListener("click", () => cleanup(false));
    cancelBtn.addEventListener("click", () => cleanup(false));
    primaryBtn.addEventListener("click", () => cleanup(true));
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
    setTimeout(() => {
      const focusTarget = dialog.querySelector("select,input,textarea,button:not(.clip-dialog-close)");
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    }, 0);
  }

  applyDialogButtonStyle(button) {
    button.style.background = "color-mix(in srgb,var(--cards-bg) 70%, var(--input-bg-color) 30%)";
    button.style.border = "2px solid color-mix(in srgb,var(--sidebar-border-color) 60%, var(--input-text-color,#ffffff) 40%)";
    button.style.color = "inherit";
    button.style.cursor = "pointer";
    button.style.fontSize = "13px";
    button.style.fontWeight = "600";
    button.style.padding = "7px 12px";
    button.style.borderRadius = "var(--ed-radius-normal)";
    button.style.boxShadow = "0 2px 6px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.08)";
  }

  /**
   * Stage 1 of parse-and-create. Creates the parent record and all child records
   * (with bodies). Does NOT create parent→child link line items — that's stage 2,
   * intentionally deferred so the parent can be displayed immediately.
   *
   * Returns: { parentRecord, parentGuid, title, createdChildren }
   * For onePage mode, createdChildren is [].
   */
  async createParsedRecordsExceptLinks(collection, parsePlan) {
    if (!parsePlan || !parsePlan.parentTitle) {
      throw new Error("Parse plan is missing a title.");
    }

    if (parsePlan.mode === "onePage") {
      const guid = collection.createRecord(parsePlan.parentTitle);
      if (!guid) throw new Error("Could not create record.");
      const record = await this.resolveRecordAfterCreate(collection, guid);
      if (!record) throw new Error("Record created but not ready yet.");
      if (parsePlan.tag) this.applyTag(collection, record, parsePlan.tag);
      if (parsePlan.parentPageName) {
        const parentPage = await this.findRecordByName(collection, parsePlan.parentPageName);
        if (parentPage) await this.setSubPageOfRecord(record, parentPage.guid);
      }
      if (parsePlan.body) {
        await record.insertFromPlainText(parsePlan.body, null, null);
      }
      return {
        parentRecord: record,
        parentGuid: guid,
        title: record.getName() || parsePlan.parentTitle,
        createdChildren: [],
      };
    }

    const parentGuid = collection.createRecord(parsePlan.parentTitle);
    if (!parentGuid) throw new Error("Could not create parent record.");


    const parentRecord = await this.resolveRecordAfterCreate(collection, parentGuid);
    if (!parentRecord) throw new Error("Parent record created but not ready yet.");
   // --- DIAGNOSTIC ---
this._diagnoseTagging(collection, parentRecord, parsePlan.tag);
// --- END DIAGNOSTIC ---
    if (parsePlan.tag) this.applyTag(collection, parentRecord, parsePlan.tag);

    if (parsePlan.parentPageName) {
      const parentPage = await this.findRecordByName(collection, parsePlan.parentPageName);
      if (parentPage) await this.setSubPageOfRecord(parentRecord, parentPage.guid);
    }

    const createdChildren = [];
    for (const childPlan of parsePlan.children || []) {
      const childGuid = collection.createRecord(childPlan.title);
      if (!childGuid) continue;
      const child = await this.resolveRecordAfterCreate(collection, childGuid);
      if (!child) continue;

      if (parsePlan.tag) this.applyTag(collection, child, parsePlan.tag);
      if (childPlan.body) {
        await child.insertFromPlainText(childPlan.body, null, null);
      }
      await this.setSubPageOfRecord(child, parentRecord.guid);
      createdChildren.push({ guid: child.guid, title: child.getName() || childPlan.title });
    }

    return {
      parentRecord,
      parentGuid: parentRecord.guid,
      title: parentRecord.getName() || parsePlan.parentTitle,
      createdChildren,
    };
  }

  async setSubPageOfRecord(record, parentGuid) {
    if (!record || !parentGuid || typeof record.setSubPageOf !== "function") return;
    await record.setSubPageOf(parentGuid);
  }

  /**
   * Stage 2 of parse-and-create. Creates the parent→child link items inside
   * the parent record, sequentially. Runs in the background while the user is
   * already viewing the parent. On any failure, fires a toaster summarizing
   * the count.
   */
  createParentLinksInBackground(parentRecord, createdChildren, parsePlan) {
    if (!parentRecord || !createdChildren || !createdChildren.length) return;
    if (parsePlan && parsePlan.createParentLinks === false) return;

    (async () => {
      let succeeded = 0;
      let afterLinkItem = null;
      for (const child of createdChildren) {
        try {
          const li = await parentRecord.createLineItem(null, afterLinkItem, "text", [
            { type: "ref", text: { guid: child.guid, title: child.title } },
          ], null);
          if (li) {
            afterLinkItem = li;
            succeeded += 1;
          }
        } catch (_) {
          /* counted as failure below */
        }
      }
      const total = createdChildren.length;
      if (succeeded < total) {
        this.ui.addToaster({
          title: "Some links failed",
          message: `${total - succeeded} of ${total} parent links could not be created.`,
          dismissible: true,
          autoDestroyTime: 7000,
        });
      }
    })().catch((err) => {
      this.ui.addToaster({
        title: "Link creation failed",
        message: err && err.message ? err.message : String(err),
        dismissible: true,
        autoDestroyTime: 7000,
      });
    });
  }

  async findRecordByName(collection, name) {
    const target = (name || "").trim().toLowerCase();
    if (!target) return null;
    const records = await collection.getAllRecords();
    if (!records || !Array.isArray(records)) return null;
    for (const r of records) {
      const n = (r.getName && r.getName()) || "";
      if (n.trim().toLowerCase() === target) return r;
    }
    return null;
  }

_diagnoseTagging(collection, record, tag) {
  console.group("[Clipper] Tag diagnostic");
  console.log("Tag value to apply:", tag);
  console.log("Collection name:", collection.getName());
  console.log("Collection guid:", collection.getGuid());

  // 1. The schema. This is what plugin.json "fields" looks like at runtime.
  try {
    const conf = collection.getConfiguration();
    const fields = (conf && conf.fields) || [];
    console.log("Schema fields:", fields.map(f => ({
      id: f.id,
      label: f.label,
      type: f.type,        // look for "hashtag" here
      many: f.many,        // true = multi-value
      active: f.active,
    })));
    const hashtagFields = fields.filter(f => f && f.type === "hashtag");
    console.log("Hashtag-typed fields in schema:", hashtagFields);
  } catch (err) {
    console.warn("getConfiguration() failed:", err);
  }

  // 2. What the record actually exposes via prop("Tags") and friends.
  console.log('record.prop("Tags"):', record.prop("Tags"));
  console.log('record.prop("tags"):', record.prop("tags"));

  // 3. What getAllProperties() returns for the freshly-created record.
  //    Importantly, log the *property objects* themselves so you can see
  //    whether `.type` is even a real field on PluginProperty.
  try {
    const props = record.getAllProperties() || [];
    console.log("getAllProperties() count:", props.length);
    props.forEach((p, i) => {
      console.log(`  prop[${i}]:`, {
        name: p && p.name,
        guid: p && p.guid,
        type: p && p.type,                 // expect undefined per SDK
        keys: p && Object.keys(p),         // see what fields actually exist
        isMultiValue: typeof (p && p.isMultiValue) === "function" ? p.isMultiValue() : "n/a",
        count: typeof (p && p.count) === "function" ? p.count() : "n/a",
      });
    });
  } catch (err) {
    console.warn("getAllProperties() failed:", err);
  }

  // 4. What does the existing resolver actually pick?
  try {
    const resolved = this.resolveTagsProperty(record);
    console.log("resolveTagsProperty() returned:", resolved);
    if (resolved) {
      console.log("  resolved.name:", resolved.name);
      console.log("  resolved.guid:", resolved.guid);
      console.log("  resolved.isMultiValue?:",
        typeof resolved.isMultiValue === "function" ? resolved.isMultiValue() : "n/a");
      console.log("  resolved.values() before:",
        typeof resolved.values === "function" ? resolved.values() : "n/a");
    }
  } catch (err) {
    console.warn("resolveTagsProperty() failed:", err);
  }

  console.groupEnd();
}
  
  /**
   * Apply a hashtag-style tag to a record. Caches the property guid on first
   * successful resolution and reuses it for subsequent records, so we do not
   * walk getAllProperties() per record.
   */
  applyTag(collection, record, tag) {
    const tagPlain = stripLeadingHash(normalizeHashtag(tag));
    if (!tagPlain) return;
  
    let prop = null;
    if (this._tagsPropGuid && typeof record.prop === "function") {
      prop = record.prop(this._tagsPropGuid);
    }
    if (!prop) {
      prop = this.resolveTagsProperty(collection, record);
    }
    if (!prop) {
      console.warn("[Clipper] No hashtag property found; tag not applied:", tagPlain);
      return;
    }
  
    try {
      if (typeof prop.addValue === "function") {
        prop.addValue(tagPlain);
      } else if (typeof prop.set === "function") {
        prop.set(tagPlain);
      }
    } catch (err) {
      console.error("[Clipper] applyTag write failed:", err);
    }
  }

  /**
   * Hashtag-first resolution. Try the literal "Tags" property; otherwise scan
   * for the first property whose type is "hashtag". Caches the guid for reuse.
   */
/**
 * Hashtag-first resolution. Try common label variants for "Tags"; otherwise
 * consult the COLLECTION schema (where field.type is reliable) and bind the
 * first hashtag-typed field to the record. Caches the property guid for reuse.
 */
  resolveTagsProperty(collection, record) {
    if (!record || typeof record.prop !== "function") return null;
  
    // 1. Try common label variants directly. record.prop() is case-sensitive.
    for (const label of ["Tags", "tags", "Tag", "tag"]) {
      const direct = record.prop(label);
      if (direct) {
        this._cacheTagsPropGuid(direct);
        return direct;
      }
    }
  
    // 2. Schema-driven fallback. PluginProperty does not expose `.type` at
    //    runtime, but PropertyField in the collection schema does.
    if (collection && typeof collection.getConfiguration === "function") {
      const conf = collection.getConfiguration() || {};
      const fields = Array.isArray(conf.fields) ? conf.fields : [];
  
      // Prefer a field labelled "tags" (any case); else first active hashtag field.
      const labelled = fields.find(f =>
        f && f.active !== false && f.type === "hashtag" &&
        String(f.label || "").trim().toLowerCase() === "tags"
      );
      const chosen = labelled || fields.find(f =>
        f && f.active !== false && f.type === "hashtag"
      );
  
      if (chosen) {
        // Bind to the record. record.prop() accepts name first then guid per SDK.
        const hit = record.prop(chosen.label) || record.prop(chosen.id);
        if (hit) {
          this._cacheTagsPropGuid(hit);
          return hit;
        }
      }
    }
  
    return null;
  }

  _cacheTagsPropGuid(prop) {
    if (this._tagsPropGuid) return;
    const g = prop && (prop.guid || (typeof prop.getGuid === "function" ? prop.getGuid() : null));
    if (typeof g === "string" && g) this._tagsPropGuid = g;
  }

  /**
   * createRecord() returns a guid immediately, but DataAPI#getRecord may be
   * null until the workspace indexes the new record. Strategy:
   *   1. sync getRecord
   *   2. yield one microtask, sync getRecord again
   *   3. one collection.getAllRecords() scan
   *   4. short retry loop, sync only (no more getAllRecords per iteration)
   *   5. final sync attempt
   */
  async resolveRecordAfterCreate(collection, guid) {
    let r = this.data.getRecord(guid);
    if (r) return r;

    await Promise.resolve();
    r = this.data.getRecord(guid);
    if (r) return r;

    try {
      const all = await collection.getAllRecords();
      if (all && Array.isArray(all)) {
        for (const row of all) {
          if (row && row.guid === guid) return row;
        }
      }
    } catch (_) {
      /* fall through to retry loop */
    }

    for (let i = 0; i < RECORD_RESOLVE_RETRY_COUNT; i++) {
      await new Promise((resolve) => setTimeout(resolve, RECORD_RESOLVE_RETRY_MS));
      r = this.data.getRecord(guid);
      if (r) return r;
    }

    return this.data.getRecord(guid);
  }

  async resolveTargetCollection() {
    const custom = this.getConfiguration().custom || {};
    const named = (custom.target_collection_name || "").trim();
    if (named) {
      const collections = await this.data.getAllCollections();
      const lower = named.toLowerCase();
      for (const c of collections) {
        if (c.getName().trim().toLowerCase() === lower) {
          return { collection: c, hint: "" };
        }
      }
      return {
        collection: null,
        hint: `No collection named "${named}". Run "Clipboard Parser settings" to pick a valid default, or fix custom.target_collection_name in the plugin JSON.`,
      };
    }

    const fromPanels = await this.pickCollectionFromOpenPanels();
    if (fromPanels) {
      return { collection: fromPanels, hint: "" };
    }
    return {
      collection: null,
      hint:
        'Open a collection or a page inside it, or run "Clipboard Parser settings" to choose a default target. Journals cannot be used.',
    };
  }

  /**
   * SDK: PluginPanel#getActiveCollection — not UIAPI#getActiveCollection.
   * Falls back to panel navigation (overview → collection guid) and edit_panel record lookup.
   */
  async pickCollectionFromOpenPanels() {
    const collections = await this.data.getAllCollections();
    const byGuid = new Map();
    for (const c of collections) {
      byGuid.set(c.getGuid(), c);
    }

    const panels = [];
    const active = this.ui.getActivePanel();
    if (active) panels.push(active);
    for (const p of this.ui.getPanels()) {
      if (p !== active) panels.push(p);
    }

    for (const panel of panels) {
      const c = await this.collectionFromPanel(panel, byGuid);
      if (c && !c.isJournalPlugin()) return c;
    }
    return null;
  }

  async collectionFromPanel(panel, byGuid) {
    let col = panel.getActiveCollection();
    if (col && typeof col.isJournalPlugin === "function" && col.isJournalPlugin()) {
      col = null;
    }
    if (col) return col;

    const nav = panel.getNavigation();
    if (!nav || !nav.type) return null;

    if (nav.type === "overview" && nav.rootId) {
      const c = byGuid.get(nav.rootId);
      if (c && !c.isJournalPlugin()) return c;
    }

    const state = nav.state && typeof nav.state === "object" ? nav.state : null;
    if (state) {
      for (const key of ["collectionGuid", "collection_guid", "collectionRootGuid"]) {
        const id = state[key];
        if (typeof id === "string" && id) {
          const c = byGuid.get(id);
          if (c && !c.isJournalPlugin()) return c;
        }
      }
    }

    if (nav.type === "edit_panel" && nav.rootId) {
      return await this.findCollectionContainingRecord(nav.rootId);
    }

    return null;
  }

  async findCollectionContainingRecord(recordGuid) {
    const cols = await this.data.getAllCollections();
    for (const c of cols) {
      if (c.isJournalPlugin()) continue;
      const records = await c.getAllRecords();
      for (const r of records) {
        if (r.guid === recordGuid) return c;
      }
    }
    return null;
  }

  /**
   * Open a record in the editor — single navigateTo(edit_panel) on the
   * active panel, or a freshly created panel if none is open.
   */
  navigateToRecord(rootId) {
    let workspaceGuid = this.getWorkspaceGuid();
    for (const p of this.ui.getPanels()) {
      const nav = p.getNavigation();
      if (nav && nav.workspaceGuid) {
        workspaceGuid = nav.workspaceGuid;
        break;
      }
    }

    const panels = this.ui.getPanels();
    let panel = this.ui.getActivePanel();
    if (!panel || !panels.some((p) => p === panel)) {
      panel = panels.length ? panels[0] : null;
    }

    if (!panel) {
      this.ui.createPanel().then((created) => {
        if (!created) return;
        try {
          created.navigateTo({
            type: "edit_panel",
            rootId,
            subId: null,
            workspaceGuid,
          });
        } catch (err) {
          console.error("[Clipper] navigateTo on new panel failed:", err);
        }
      });
      return;
    }

    try {
      this.ui.setActivePanel(panel);
    } catch (_) {
      /* ignore */
    }

    try {
      panel.navigateTo({
        type: "edit_panel",
        rootId,
        subId: null,
        workspaceGuid,
      });
    } catch (err) {
      console.error("[Clipper] navigateTo failed:", err);
    }
  }

  /** Upload each image blob and append image line items after existing body content. */
  async appendClipboardImages(record, images) {
    if (!images.length) return;

    const recordGuid = record.guid;
    let afterItem = null;
    const items = await record.getLineItems(false);
    if (items && items.length) {
      for (const item of items) {
        const pg = item.parent_guid;
        if (pg == null || pg === recordGuid) afterItem = item;
      }
    }

    for (let i = 0; i < images.length; i++) {
      const { blob, mime } = images[i];
      const safeMime = mime && mime.startsWith("image/") ? mime : "image/png";
      const ext = mimeToImageExt(safeMime);
      const name = `clip-${Date.now()}-${i}.${ext}`;
      const file = new File([blob], name, { type: safeMime });
      const uploaded = await this.data.uploadBlob(file);
      if (!uploaded) continue;

      const lineItem = await record.createLineItem(null, afterItem, "image", null, null);
      if (!lineItem) continue;

      await lineItem.setBlob(uploaded);
      afterItem = lineItem;
    }
  }
}

function clonePluginConfiguration(conf) {
  return JSON.parse(JSON.stringify(conf));
}

function htmlToPlainText(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body && doc.body.innerText) || "";
  } catch (_) {
    return "";
  }
}

function normalizeParserProfiles(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(normalizeParseSpec).filter((profile) => profile.name || profile.mode);
}

function normalizeParseSpec(spec) {
  const source = spec && typeof spec === "object" ? spec : {};
  const mode = ["onePage", "delimiterSections", "weekdaySections", "regexSections"].includes(source.mode)
    ? source.mode
    : DEFAULT_PARSE_SPEC.mode;
  return {
    name: String(source.name || "").trim(),
    mode,
    parentTitle: String(source.parentTitle || "").trim(),
    parentTitlePrefix: String(source.parentTitlePrefix || DEFAULT_PARSE_SPEC.parentTitlePrefix).trim(),
    delimiter: String(source.delimiter || DEFAULT_PARSE_SPEC.delimiter),
    sectionStartRegex: String(source.sectionStartRegex || DEFAULT_PARSE_SPEC.sectionStartRegex).trim(),
    childTitle: String(source.childTitle || DEFAULT_PARSE_SPEC.childTitle),
    childBody: String(source.childBody || DEFAULT_PARSE_SPEC.childBody),
    parentPageName: String(source.parentPageName || "").trim(),
    tag: String(source.tag || "").trim(),
    createParentLinks: source.createParentLinks !== false,
    stripBlankLines: source.stripBlankLines === true,
  };
}

function buildParsePlan(source, rawSpec) {
  const text = String(source || "").trim();
  if (!text) throw new Error("Clipboard text is empty.");

  const spec = normalizeParseSpec(rawSpec);
  if (spec.mode === "onePage") {
    return {
      mode: "onePage",
      parentTitle: limitRecordTitle(spec.parentTitle || pickRecordTitle(text, false)),
      body: spec.stripBlankLines ? stripBlankLines(text) : text,
      parentPageName: spec.parentPageName,
      tag: spec.tag,
      stripBlankLines: spec.stripBlankLines,
      warnings: [],
    };
  }

  let sections = [];
  if (spec.mode === "delimiterSections") {
    sections = parseSectionsByDelimiter(text, spec.delimiter);
  } else if (spec.mode === "weekdaySections") {
    sections = parseWeekdaySections(text);
  } else if (spec.mode === "regexSections") {
    sections = parseSectionsByRegex(text, spec.sectionStartRegex);
  }

  if (!sections.length) {
    throw new Error("No sections found for the selected parse mode.");
  }
  if (sections.length > MAX_PARSE_CHILDREN) {
    throw new Error(`Parser found ${sections.length} sections. Limit the input to ${MAX_PARSE_CHILDREN} sections or use a narrower spec.`);
  }

  const defaultParentTitle = spec.mode === "weekdaySections"
    ? buildWeekOfTitle(sections, spec.parentTitlePrefix)
    : "Parsed Clipboard";
  const parentTitle = limitRecordTitle(spec.parentTitle || defaultParentTitle);
  const children = sections.map((section, index) => {
    const ctx = {
      index: String(index + 1),
      heading: section.title,
      body: section.body || "",
      day: section.day || "",
      parentTitle,
    };
    const childBody = formatTemplate(spec.childBody || "{heading}\n{body}", ctx);
    return {
      title: limitRecordTitle(formatTemplate(spec.childTitle || "{heading}", ctx) || section.title || `Section ${index + 1}`),
      body: spec.stripBlankLines ? stripBlankLines(childBody) : childBody,
    };
  });

  return {
    mode: spec.mode,
    parentTitle,
    children,
    parentPageName: spec.parentPageName,
    tag: spec.tag,
    createParentLinks: spec.createParentLinks,
    stripBlankLines: spec.stripBlankLines,
    warnings: buildParseWarnings(children),
  };
}

function parseSectionsByDelimiter(text, delimiter) {
  const delim = String(delimiter || "").trim();
  if (!delim) throw new Error("Delimiter is required.");
  const chunks = String(text || "")
    .split(delim)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.map((chunk, index) => sectionFromChunk(chunk, `Section ${index + 1}`));
}

function parseSectionsByRegex(text, regexText) {
  const raw = String(regexText || "").trim();
  if (!raw) throw new Error("Section heading regex is required.");
  if (raw.length > 500) throw new Error("Section heading regex is too long.");

  let regex;
  try {
    regex = new RegExp(raw, "i");
  } catch (err) {
    throw new Error(`Invalid section heading regex: ${err && err.message ? err.message : String(err)}`);
  }

  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(regex);
    if (!match) continue;
    const heading = normalizeSpaces(match[1] || match[0]);
    starts.push({ idx: i, title: heading || `Section ${starts.length + 1}` });
  }

  const sections = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].idx : lines.length;
    sections.push({
      title: start.title,
      body: trimEmptyLines(lines.slice(start.idx + 1, end)).join("\n"),
    });
  }
  return sections;
}

function sectionFromChunk(chunk, fallbackTitle) {
  const lines = String(chunk || "").replace(/\r\n?/g, "\n").split("\n");
  const trimmed = trimEmptyLines(lines);
  const firstLine = trimmed.find((line) => String(line || "").trim().length > 0) || fallbackTitle;
  const title = normalizeSpaces(firstLine) || fallbackTitle;
  const body = trimEmptyLines(trimmed.slice(1)).join("\n");
  return { title, body };
}

function formatTemplate(template, context) {
  return String(template || "").replace(/\{(index|heading|body|day|parentTitle)\}/g, (_, key) => {
    return context[key] == null ? "" : String(context[key]);
  });
}

function stripBlankLines(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function limitRecordTitle(title) {
  const trimmed = normalizeSpaces(title);
  return (trimmed || "Untitled").slice(0, 240);
}

function buildParseWarnings(children) {
  const warnings = [];
  if (children.some((child) => !String(child.body || "").trim())) {
    warnings.push("One or more child pages have an empty body.");
  }
  return warnings;
}

function formatParsePreview(parsePlan) {
  const lines = [];
  lines.push(`Mode: ${parsePlan.mode}`);
  lines.push(`Title: ${parsePlan.parentTitle}`);
  if (parsePlan.tag) lines.push(`Tag: ${parsePlan.tag}`);
  if (parsePlan.mode !== "onePage") {
    lines.push(`Strip blank lines: ${parsePlan.stripBlankLines ? "yes" : "no"}`);
  }
  if (parsePlan.parentPageName) lines.push(`Parent goes under: ${parsePlan.parentPageName}`);
  if (parsePlan.mode === "onePage") {
    lines.push("");
    lines.push("Creates 1 page.");
    lines.push(`Body preview: ${String(parsePlan.body || "").slice(0, 240)}`);
  } else {
    lines.push("");
    lines.push(`Creates ${parsePlan.children.length} child page(s).`);
    for (const child of parsePlan.children.slice(0, 8)) {
      lines.push(`- ${child.title}`);
    }
    if (parsePlan.children.length > 8) lines.push(`- ... ${parsePlan.children.length - 8} more`);
  }
  if (parsePlan.warnings && parsePlan.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of parsePlan.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

function parseWeekdaySections(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const starts = [];
  const dayRegex = /^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(dayRegex);
    if (!m) continue;
    const dayCanonical = capitalizeWord(m[1]);
    const rest = (m[2] || "").trim();
    const title = rest ? `${dayCanonical} ${rest}` : dayCanonical;
    starts.push({ idx: i, day: dayCanonical, title: normalizeSpaces(title) });
  }

  const sections = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].idx : lines.length;
    const bodyLines = lines.slice(start.idx + 1, end);
    sections.push({
      day: start.day,
      title: start.title,
      body: trimEmptyLines(bodyLines).join("\n"),
    });
  }

  return sections;
}

function buildWeekOfTitle(sections, prefix) {
  const titlePrefix = normalizeSpaces(prefix || "r/F45 Intel Week");
  if (!sections || !sections.length) return `${titlePrefix} (unknown)`;
  const first = sections[0];
  const last = sections[sections.length - 1];
  const start = extractDatePartFromHeader(first.title, first.day);
  const end = extractDatePartFromHeader(last.title, last.day);
  const startShort = toShortMonthDay(start);
  const endShort = toShortMonthDay(end);
  if (startShort && endShort) return `${titlePrefix} ${startShort} - ${endShort}`;
  if (startShort) return `${titlePrefix} ${startShort}`;
  return `${titlePrefix} (unknown)`;
}

function extractDatePartFromHeader(header, dayName) {
  const raw = normalizeSpaces(String(header || ""));
  const dayPrefix = new RegExp(`^${dayName}\\s*`, "i");
  let rest = raw.replace(dayPrefix, "").trim();
  if (!rest) return "";
  const colon = rest.indexOf(":");
  if (colon >= 0) {
    rest = rest.slice(0, colon).trim();
  }
  return rest;
}

function trimEmptyLines(lines) {
  let s = 0;
  let e = lines.length - 1;
  while (s <= e && !String(lines[s] || "").trim()) s++;
  while (e >= s && !String(lines[e] || "").trim()) e--;
  return s > e ? [] : lines.slice(s, e + 1);
}

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function capitalizeWord(s) {
  const t = String(s || "").toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

function stripLeadingHash(s) {
  return String(s || "").replace(/^#+/, "");
}

function normalizeHashtag(s) {
  const raw = stripLeadingHash(s).trim();
  return raw ? `#${raw}` : "#";
}

function toShortMonthDay(raw) {
  const s = normalizeSpaces(raw).replace(/,$/, "");
  if (!s) return "";

  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return s;

  const monthText = m[1].toLowerCase();
  const day = String(parseInt(m[2], 10));
  const monthMap = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  };
  const monthNum = monthMap[monthText];
  if (!monthNum) return s;
  return `${String(monthNum).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function pickRecordTitle(plain, imageOnly) {
  const t = (plain || "").trim();
  if (t) {
    const firstLine = t.split(/\r?\n/).find((l) => l.trim().length > 0) || t;
    const candidate = firstLine.trim().slice(0, 120);
    if (candidate) return candidate;
  }
  if (imageOnly) return `Image clip · ${new Date().toLocaleString()}`;
  return `Web clip · ${new Date().toLocaleString()}`;
}

function mimeToImageExt(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/avif") return "avif";
  if (mime === "image/bmp") return "bmp";
  return "img";
}

function clipboardHasData(clipboard) {
  if (!clipboard || typeof clipboard !== "object") return false;
  const plain = (clipboard.plain || "").trim();
  const html = (clipboard.html || "").trim();
  const images = Array.isArray(clipboard.images) ? clipboard.images : [];
  return !!plain || !!html || images.length > 0;
}

async function readClipboard() {
  let plain = "";
  let html = "";
  /** @type {{ blob: Blob; mime: string }[]} */
  const images = [];

  if (navigator.clipboard && typeof navigator.clipboard.read === "function") {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const types = item.types || [];
        for (const mimeType of types) {
          if (mimeType === "text/html") {
            const blob = await item.getType("text/html");
            html = await blob.text();
          } else if (mimeType === "text/plain") {
            const blob = await item.getType("text/plain");
            plain = await blob.text();
          } else if (mimeType.startsWith("image/")) {
            const blob = await item.getType(mimeType);
            images.push({ blob, mime: mimeType });
          }
        }
      }
    } catch (_) {
      /* fall through to readText */
    }
  }

  if (!plain.trim() && !html.trim() && !images.length) {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      throw new Error("Clipboard API is not available in this context.");
    }
    try {
      plain = await navigator.clipboard.readText();
    } catch (e) {
      throw new Error(
        "Could not read the clipboard. Allow clipboard access for Thymer in the browser prompt, or use a context where read is permitted."
      );
    }
  }

  return { plain, html, images };
}