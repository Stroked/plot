import {pointer, select} from "d3";
import {formatDefault} from "../format.js";
import {Mark} from "../mark.js";
import {keyword, maybeFrameAnchor, maybeTuple} from "../options.js";
import {applyFrameAnchor} from "../style.js";
import {inferTickFormat} from "./axis.js";
import {string} from "../options.js";
import {number} from "../options.js";
import {clipper} from "./text.js";
import {applyIndirectTextStyles} from "./text.js";

const defaults = {
  ariaLabel: "tooltip",
  fill: "none",
  stroke: "none"
};

export class Tooltip extends Mark {
  constructor(data, options = {}) {
    const {
      x,
      y,
      maxRadius = 40,
      corner,
      monospace,
      fontFamily = monospace ? "ui-monospace, monospace" : undefined,
      fontSize,
      fontStyle,
      fontVariant,
      fontWeight,
      lineHeight = 1,
      lineWidth = Infinity,
      frameAnchor
    } = options;
    super(
      data,
      {
        x: {value: x, scale: "x", optional: true},
        y: {value: y, scale: "y", optional: true}
      },
      options,
      defaults
    );
    this.corner = maybeCorner(corner);
    this.frameAnchor = maybeFrameAnchor(frameAnchor);
    this.indexesBySvg = new WeakMap();
    this.textAnchor = "start"; // TODO option?
    this.lineHeight = +lineHeight;
    this.lineWidth = +lineWidth;
    this.monospace = !!monospace;
    this.fontFamily = string(fontFamily);
    this.fontSize = number(fontSize);
    this.fontStyle = string(fontStyle);
    this.fontVariant = string(fontVariant);
    this.fontWeight = string(fontWeight);
    this.maxRadius = +maxRadius;
    this.clipLine = clipper(this);
  }
  render(index, scales, {x: X, y: Y, channels}, dimensions, context) {
    const {fx, fy} = scales;
    const formatFx = fx && inferTickFormat(fx);
    const formatFy = fy && inferTickFormat(fy);
    const [cx, cy] = applyFrameAnchor(this, dimensions);
    const {corner, lineHeight, maxRadius, fx: fxv, fy: fyv} = this;
    const {marginLeft, marginTop} = dimensions;
    const svg = context.ownerSVGElement;
    let indexes = this.indexesBySvg.get(svg);
    if (indexes) return void indexes.push(index);
    this.indexesBySvg.set(svg, (indexes = [index]));
    const r = 8; // padding
    const dx = 0; // offsetLeft
    const dy = 12; // offsetTop
    const foreground = "black";
    const background = "white";
    const kx = 1,
      ky = 1; // TODO one-dimensional bias
    let i, xi, yi; // currently-focused index and position
    let sticky = false;
    const dot = select(svg)
      .on("pointermove", (event) => {
        if (sticky) return;
        let ii, fxi, fyi;
        if (event.buttons === 0) {
          const [xp, yp] = pointer(event);
          let ri = kx * ky * kx * ky * maxRadius * maxRadius;
          for (const index of indexes) {
            const fxj = index.fx;
            const fyj = index.fy;
            const oxj = fx ? fx(fxj) - marginLeft : 0;
            const oyj = fy ? fy(fyj) - marginTop : 0;
            for (const j of index) {
              const xj = (X ? X[j] : cx) + oxj;
              const yj = (Y ? Y[j] : cy) + oyj;
              const dx = kx * (xj - xp);
              const dy = ky * (yj - yp);
              const rj = dx * dx + dy * dy;
              if (rj <= ri) (ii = j), (ri = rj), (xi = xj), (yi = yj), (fxi = fxj), (fyi = fyj);
            }
          }
        }
        if (i === ii) return;
        i = ii;
        if (i === undefined) {
          dot.attr("display", "none");
        } else {
          dot.attr("display", "inline");
          dot.attr("transform", `translate(${Math.round(xi)},${Math.round(yi)})`);
          const text = [];
          for (const key in channels) {
            let channel = channels[key];
            while (channel.source) channel = channel.source;
            if (channel.source === null) continue; // e.g., dodgeY’s y
            const label = scales[channel.scale]?.label ?? key;
            text.push([label, formatDefault(channel.value[i])]);
          }
          if (fxv != null) text.push([fx.label ?? "fx", formatFx(fxi)]);
          if (fyv != null) text.push([fy.label ?? "fy", formatFy(fyi)]);
          const tspan = content
            .selectChildren()
            .data(text)
            .join("tspan")
            .attr("x", 0)
            .attr("y", (d, i) => `${i * lineHeight}em`);
          tspan
            .selectChildren()
            .data((d) => d)
            .join("tspan")
            .attr("font-weight", (d, i) => (i ? null : "bold"))
            .text((d, i) => (i ? ` ${d}\u200b` : String(d))); // zwsp for double-click
          const {width: w, height: h} = content.node().getBBox();
          const {width, height} = svg.getBBox();
          const cx = (/-left$/.test(corner) ? xi + w + dx + r * 2 > width : xi - w - dx - r * 2 > 0) ? "right" : "left";
          const cy = (/^top-/.test(corner) ? yi + h + dy + r * 2 > height : yi - h - dy - r * 2 > 0) ? "bottom" : "top";
          const cc = `${cy}-${cx}`;
          const oy = getLineOffset(cc, text) * lineHeight;
          tspan.attr("y", (d, i) => `${i * lineHeight + oy}em`);
          path.attr("d", getPath(cc, dx, dy, r, w, h));
          content.attr("transform", getTextTransform(cc, dx, dy, r, w, h));
        }
      })
      .on("pointerdown", () => {
        if (sticky) {
          sticky = false;
          dot.attr("display", "none");
          dot.attr("pointer-events", "none");
        } else if (i !== undefined) {
          sticky = true;
          dot.attr("pointer-events", "all");
        }
      })
      .on("pointerleave", () => sticky || dot.attr("display", "none"))
      .append("g")
      .attr("aria-label", "tooltip")
      .attr("pointer-events", "none") // initially not sticky
      .attr("display", "none");
    const path = dot
      .append("path")
      .attr("fill", background)
      .attr("stroke", foreground)
      .attr("filter", "drop-shadow(0 3px 4px rgba(0,0,0,0.2))")
      .on("pointerdown pointermove", (event) => event.stopPropagation());
    const content = dot
      .append("text")
      .attr("fill", foreground)
      .call(applyIndirectTextStyles, this)
      .on("pointerdown pointermove", (event) => event.stopPropagation());
    return null;
  }
}

export function tooltip(data, {x, y, ...options} = {}) {
  if (options.frameAnchor === undefined) [x, y] = maybeTuple(x, y);
  return new Tooltip(data, {...options, x, y});
}

function maybeCorner(value = "bottom-left") {
  return keyword(value, "corner", ["top-left", "top-right", "bottom-right", "bottom-left"]);
}

function getLineOffset(corner, text) {
  return /^top-/.test(corner) ? 0.94 : 0.71 - text.length;
}

function getTextTransform(corner, dx, dy, r, width) {
  const x = /-left$/.test(corner) ? dx + r : -width - dx - r;
  const y = /^top-/.test(corner) ? dy + r : -dy - r;
  return `translate(${x},${y})`;
}

function getPath(corner, dx, dy, r, width, height) {
  const w = width + r * 2;
  const h = height + r * 2;
  switch (corner) {
    case "top-left":
      return `M0,0l${dy},${dy}h${w - dy}v${h}h${-w}z`;
    case "top-right":
      return `M0,0l${-dy},${dy}h${dy - w}v${h}h${w}z`;
    case "bottom-left":
      return `M0,0l${dy},${-dy}h${w - dy}v${-h}h${-w}z`;
    case "bottom-right":
      return `M0,0l${-dy},${-dy}h${dy - w}v${-h}h${w}z`;
  }
}
