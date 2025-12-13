import * as webpack from "./webpack";
import * as react from "./react";

webpack._2_hookWebpackChunk((window as any).webpackChunkwebapp, "slack");
react.init();

//         let PlainText = ({id: e, text: t, parent: a, emoji: r=!0, emojiSize: d, maxNewlines: m, maxCharacters: u, onRender: p=l.A, noJumbomoji: h=!0, className: _, showTooltips: f=!0, noLinking: g=!1, customLineEnding: b, dataQA: y="bk-plain_text_element", noHighlights: x, noHexColors: A, noCode: E, noQuotes: C}) => {
export const PlainText = react.virtualComponent<{
  id?: string;
  text: string;
  // parent
  // default true
  emoji?: boolean;
  emojiSize?: number;
  maxNewlines?: number;
  maxCharacters?: number;
  // onRender
  // default true
  noJumbomoji?: boolean;
  // className
  // default true
  showTooltips?: boolean;
  // default true
  noLinking?: true;
  // customLineEnding
  // default "bk-plain_text_element"
  dataQA?: string;
  noHighlights?: boolean;
  noHexColors?: boolean;
  noCode?: boolean;
  noQuotes?: boolean;
}>("PlainText");
export const MrkdwnElement = react.virtualComponent<{
  text: string;
  // parent
  maxNewlines?: number;
  maxCharacters?: number;
  // onRender
  // clogLinkClick
  // customFormatHandler
  // customLineEnding
  noJumbomoji?: boolean;
  noLinking?: boolean;
  // emojiDisplayInfo
  // blocksContainerContext
}>("MrkdwnElement");
export const Tabs = react.virtualComponent<{
  tabs: {
    label: React.ReactElement;
    content: React.ReactElement;
    svgIcon: { name: string; };
    id?: string;
    "aria-labelledby"?: string;
    "aria-label"?: string;
  }[],
  onTabChange?: (id: string, e: React.UIEvent) => void;
  currentTabId?: string;
}>("Tabs");
export const TypingNames = react.virtualComponent<{
  firstTyper: string;
  secondTyper?: string;
  severalPeopleAreTyping?: boolean;
}>("TypingNames");

const cs = {
  PlainText,
  MrkdwnElement,
  Tabs,
  TypingNames,
};

globalThis.$components = {};
for (const [k, v] of Object.entries(cs)) {
  globalThis.$components[k] = v;
}
