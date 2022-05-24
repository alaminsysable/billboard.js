/**
 * Copyright (c) 2017 ~ present NAVER Corp.
 * billboard.js project is licensed under the MIT license
 */
import {select as d3Select} from "d3-selection";
import {scaleOrdinal as d3ScaleOrdinal} from "d3-scale";
import {document, window} from "../../module/browser";
import {$ARC, $COLOR, $SHAPE} from "../../config/classes";
import {KEY} from "../../module/Cache";
import {notEmpty, isFunction, isObject, isString} from "../../module/util";
import {IArcData, IDataRow} from "../data/IData";

/**
 * Set pattern's background color
 * (it adds a <rect> element to simulate bg-color)
 * @param {SVGPatternElement} pattern SVG pattern element
 * @param {string} color Color string
 * @param {string} id ID to be set
 * @returns {{id: string, node: SVGPatternElement}}
 * @private
 */
const colorizePattern = (pattern, color, id: string) => {
	const node = d3Select(pattern.cloneNode(true));

	node
		.attr("id", id)
		.insert("rect", ":first-child")
		.attr("width", node.attr("width"))
		.attr("height", node.attr("height"))
		.style("fill", color);

	return {
		id,
		node: node.node()
	};
};

// Replacement of d3.schemeCategory10.
// Contained differently depend on d3 version: v4(d3-scale), v5(d3-scale-chromatic)
const schemeCategory10 = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

export default {
	/**
	 * Get color pattern from CSS file
	 * CSS should be defined as: background-image: url("#00c73c;#fa7171; ...");
	 * @returns {Array}
	 * @private
	 */
	getColorFromCss(): string[] {
		const cacheKey = KEY.colorPattern;
		const {body} = document;
		let pattern = body[cacheKey];

		if (!pattern) {
			const delimiter = ";";
			const span = document.createElement("span");

			span.className = $COLOR.colorPattern;
			span.style.display = "none";
			body.appendChild(span);

			const content = window.getComputedStyle(span).backgroundImage;

			span.parentNode.removeChild(span);

			if (content.indexOf(delimiter) > -1) {
				pattern = content
					.replace(/url[^#]*|["'()]|(\s|%20)/g, "")
					.split(delimiter)
					.map(v => v.trim().replace(/[\"'\s]/g, ""))
					.filter(Boolean);

				body[cacheKey] = pattern;
			}
		}

		return pattern;
	},

	generateColor(): Function {
		const $$ = this;
		const {config} = $$;
		const colors = config.data_colors;
		const callback = config.data_color;
		const ids: string[] = [];

		let pattern = notEmpty(config.color_pattern) ? config.color_pattern :
			d3ScaleOrdinal($$.getColorFromCss() || schemeCategory10).range();

		const originalColorPattern = pattern;

		if (isFunction(config.color_tiles)) {
			const tiles = config.color_tiles.bind($$.api)();

			// Add background color to patterns
			const colorizedPatterns = pattern.map((p, index) => {
				const color = p.replace(/[#\(\)\s,]/g, "");
				const id = `${$$.state.datetimeId}-pattern-${color}-${index}`;

				return colorizePattern(tiles[index % tiles.length], p, id);
			});

			pattern = colorizedPatterns.map(p => `url(#${p.id})`);
			$$.patterns = colorizedPatterns;
		}

		return function(d: IDataRow | IArcData | string): string {
			const id: string = (d as IDataRow).id || (d as IArcData).data?.id || d as string;
			const isLine = $$.isTypeOf(id, ["line", "spline", "step"]) || !config.data_types[id];
			let color;

			// if callback function is provided
			if (isFunction(colors[id])) {
				color = colors[id].bind($$.api)(d);

			// if specified, choose that color
			} else if (colors[id]) {
				color = colors[id];

			// if not specified, choose from pattern
			} else {
				if (ids.indexOf(id) < 0) {
					ids.push(id);
				}

				color = isLine ? originalColorPattern[ids.indexOf(id) % originalColorPattern.length] :
					pattern[ids.indexOf(id) % pattern.length];

				colors[id] = color;
			}

			return isFunction(callback) ?
				callback.bind($$.api)(color, d) : color;
		};
	},

	generateLevelColor(): Function | null {
		const $$ = this;
		const {config} = $$;
		const colors = config.color_pattern;
		const threshold = config.color_threshold;
		const asValue = threshold.unit === "value";
		const max = threshold.max || 100;
		const values = threshold.values &&
			threshold.values.length ? threshold.values : [];

		return notEmpty(threshold) ? function(value) {
			const v = asValue ? value : (value * 100 / max);
			let color = colors[colors.length - 1];

			for (let i = 0, l = values.length; i < l; i++) {
				if (v <= values[i]) {
					color = colors[i];
					break;
				}
			}

			return color;
		} : null;
	},

	/**
	 * Append data backgound color filter definition
	 * @param {string} color Color string
	 * @private
	 */
	generateDataLabelBackgroundColorFilter(color?: string): void {
		const $$ = this;
		const {$el, config, state} = $$;
		const backgroundColors = color || config.data_labels_backgroundColors;

		if (backgroundColors) {
			let ids: string[] = [];

			if (isString(backgroundColors)) {
				ids.push("");
			} else if (isObject(backgroundColors)) {
				ids = Object.keys(backgroundColors);
			}

			ids.forEach(v => {
				const id = `${state.datetimeId}-labels-bg${$$.getTargetSelectorSuffix(v)}${color ? $$.getTargetSelectorSuffix(color) : ""}`;

				$el.defs.append("filter")
					.attr("x", "0")
					.attr("y", "0")
					.attr("width", "1")
					.attr("height", "1")
					.attr("id", id)
					.html(`<feFlood flood-color="${v === "" ? backgroundColors : backgroundColors[v]}" /><feComposite in="SourceGraphic"/>`);
			});
		}
	},

	/**
	 * Set the data over color.
	 * When is out, will restate in its previous color value
	 * @param {boolean} isOver true: set overed color, false: restore
	 * @param {number|object} d target index or data object for Arc type
	 * @private
	 */
	setOverColor(isOver: boolean, d): void {
		const $$ = this;
		const {config, $el: {main}} = $$;
		const onover = config.color_onover;
		let color = isOver ? onover : $$.color;

		if (isObject(color)) {
			color = ({id}) => (id in onover ? onover[id] : $$.color(id));
		} else if (isString(color)) {
			color = () => onover;
		} else if (isFunction(onover)) {
			color = color.bind($$.api);
		}

		main.selectAll(
			isObject(d) ?
				// when is Arc type
				`.${$ARC.arc}${$$.getTargetSelectorSuffix(d.id)}` :
				`.${$SHAPE.shape}-${d}`
		).style("fill", color);
	}
};
