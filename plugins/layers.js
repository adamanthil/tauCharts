// jscs:disable *
(function (factory) {
    if (typeof define === 'function' && define.amd) {
        define(['tauCharts'], function (tauPlugins) {
            return factory(tauPlugins);
        });
    } else if (typeof module === 'object' && module.exports) {
        var tauPlugins = require('tauCharts');
        module.exports = factory(tauPlugins);
    } else {
        factory(this.tauCharts);
    }
})(function (tauCharts) {

    var _ = tauCharts.api._;
    var pluginsSDK = tauCharts.api.pluginsSDK;

    function layers(xSettings) {

        var settings = _.defaults(
            xSettings || {},
            {
                label: 'Layer Type',
                hideError: false,
                showPanel: true,
                showLayers: true,
                mode: 'merge'
            });

        var ELEMENT_TYPE = {
            line: 'ELEMENT.LINE',
            area: 'ELEMENT.AREA',
            dots: 'ELEMENT.POINT',
            scatterplot: 'ELEMENT.POINT',
            bar: 'ELEMENT.INTERVAL',
            'stacked-bar': 'ELEMENT.INTERVAL.STACKED'
        };

        return {

            init: function (chart) {

                this._chart = chart;

                var spec = pluginsSDK.spec(this._chart.getSpec());
                var errors = this.checkIfApplicable(spec);
                this._isApplicable = (errors.length === 0);

                spec.addTransformation('defined-only', function (data, props) {
                    var k = props.key;
                    return _(data)
                        .chain()
                        .filter(function (row) {
                            return ((row[k] !== null) && (typeof (row[k]) !== 'undefined'));
                        })
                        .value();
                });

                if (!this._isApplicable) {
                    var log = spec.getSettings('log');
                    log('[layers plugin]: is not applicable. ' + errors.join(' / '));
                    return;
                }

                this.isFacet = this.checkIsFacet(spec);
                this.primaryY = this.findPrimaryLayer(spec);
                var layersText = this.getLayersText();
                var layersGroup = this.getLayersGroup();

                var metaField = settings.label;
                this.fieldColorScale = metaField;

                spec.setSettings('excludeNull', false)
                    .setSettings('fitModel', null)
                    .addScale(metaField, {type: 'color', source: '/', dim: metaField, brewer: settings.brewer})
                    .addTransformation('slice-layer', function (data, props) {
                        var k = props.key;
                        var g = props.group;
                        if (g) {
                            return _(data).filter(function (row) {
                                return (
                                    (row.hasOwnProperty(g))
                                    &&
                                    (row[g] !== null)
                                    &&
                                    (typeof (row[g]) !== 'undefined')
                                );
                            });
                        } else {
                            return _(data).filter(function (row) {
                                return (
                                    (row[metaField] === layersText[k])
                                    &&
                                    (row[k] !== null)
                                    &&
                                    (typeof (row[k]) !== 'undefined')
                                );
                            });
                        }
                    });

                var layersDims = [this.primaryY]
                    .concat(settings.layers)
                    .reduce(function (memo, layer) {
                        return memo.concat(layer.y);
                    }, []);

                chart.setupChartSourceModel(function (originalSources) {

                    var newDim = {};
                    newDim[metaField] = {type: 'category'};

                    var sources = {
                        '/':{
                            dims: newDim,
                            data: []
                        }
                    };

                    sources['/'].dims = _.extend(newDim, originalSources['/'].dims);
                    sources['/'].data = originalSources['/'].data.reduce(function (memo, row) {
                        return memo.concat(layersDims.map(function (layerDim) {
                            var seed = {};
                            seed[metaField] = layersText[layerDim];
                            var g = layersGroup[layerDim];
                            if (g) {
                                seed[g] = row[layerDim];
                                seed['subLayer'] = g;
                            }
                            return _.extend(seed, row);
                        }));
                    }, []);

                    return _.extend(sources, _.omit(originalSources, '/'));
                });

                if (settings.showPanel) {

                    this._container = chart.insertToRightSidebar(this.containerTemplate);
                    this._container.classList.add('applicable-true');
                    if (settings.hideError) {
                        this._container
                            .classList
                            .add('hide-trendline-error');
                    }

                    this.uiChangeEventsDispatcher = function (e) {

                        var target = e.target;
                        var selector = target.classList;

                        if (selector.contains('i-role-show-layers')) {
                            settings.showLayers = target.checked;
                        }

                        if (selector.contains('i-role-change-mode')) {
                            settings.mode = target.value;
                        }

                        this._chart.refresh();

                    }.bind(this);

                    this._container
                        .addEventListener('change', this.uiChangeEventsDispatcher, false);
                }
            },

            getLayersText: function () {
                return ([this.primaryY]
                    .concat(settings.layers)
                    .reduce(function (memo, layer) {

                        if (_.isArray(layer.y)) {
                            memo = layer.y.reduce(function (state, y) {
                                state[y] = y;
                                return state;
                            }, memo);
                        } else {
                            memo[layer.y] = this.extractLabel(layer);
                        }

                        return memo;

                    }.bind(this), {}));
            },

            getLayersGroup: function () {
                return ([this.primaryY]
                    .concat(settings.layers)
                    .reduce(function (memo, layer) {
                        var g = null;
                        if (_.isArray(layer.y)) {
                            g = layer.y.join(', ');
                        }

                        return _.flatten([layer.y]).reduce(function (memo, y) {
                            memo[y] = g;
                            return memo;
                        }, memo);
                    }.bind(this), {}));
            },

            checkIsFacet: function (spec) {

                return spec.unit().reduce(function (state, unit, parent) {

                    if (state) {
                        return state;
                    }

                    if (parent && (parent.type === 'COORDS.RECT') && (unit.type === 'COORDS.RECT')) {
                        state = true;
                        return state;
                    }

                    return state;

                }, false);
            },

            checkIfApplicable: function (spec) {

                return spec.unit().reduce(function (errors, unit, parent) {

                    if (parent && (parent.type !== 'COORDS.RECT')) {
                        return errors.concat('Chart specification contains non-rectangular coordinates');
                    }

                    if (parent && (parent.type === 'COORDS.RECT') && (unit.type !== 'COORDS.RECT')) {
                        // is Y axis a measure?
                        var yScale = spec.getScale(unit.y);
                        if (spec.getSourceDim(yScale.source, yScale.dim).type !== 'measure') {
                            return errors.concat('Y scale is not a measure');
                        }
                    }

                    return errors;

                }, []);
            },

            isLeafElement: function (unit, parent) {
                return ((parent) && (parent.type === 'COORDS.RECT') && (unit.type !== 'COORDS.RECT'));
            },

            isFirstCoordNode: function (unit, parent) {
                return (!parent && unit && (unit.type === 'COORDS.RECT'));
            },

            isFinalCoordNode: function (unit, parent) {
                return ((unit) && (unit.type === 'COORDS.RECT')
                    &&
                    (_.every(unit.units, function (subUnit) {
                        return subUnit.type !== 'COORDS.RECT';
                    }))
                );
            },

            buildLayersLayout: function (fullSpec) {

                return (fullSpec.regSource('$',
                    {
                        dims: {
                            x: {type: 'category'},
                            y: {type: 'category'}
                        },
                        data: [{x: 1, y: 1}]
                    })
                    .addScale('xLayoutScale', {type: 'ordinal', source: '$', dim: 'x'})
                    .addScale('yLayoutScale', {type: 'ordinal', source: '$', dim: 'y'})
                    .unit({
                        type: 'COORDS.RECT',
                        x: 'xLayoutScale',
                        y: 'yLayoutScale',
                        expression: {
                            source: '$',
                            inherit: false,
                            operator: false
                        },
                        guide: {
                            showGridLines: '',
                            x: {cssClass: 'facet-axis'},
                            y: {cssClass: 'facet-axis'}
                        }
                    }));
            },

            findPrimaryLayer: function (spec) {
                var self = this;
                var resY = spec.unit().reduce(function (memo, unit) {
                    return memo.concat(self.isFinalCoordNode(unit) ?
                        ({
                            y: spec.getScale(unit.y).dim,
                            guide: unit.guide.y,
                            scaleName: unit.y
                        }) :
                        ([]));
                }, []);

                return resY[0];
            },

            createPrimaryUnitReducer: function (fullSpec, currLayers, totalPad) {

                var self = this;

                return function (memo, unit, parent) {

                    if (self.isFacet && self.isFirstCoordNode(unit, parent)) {
                        unit.guide.y.label = (unit.guide.y.label || {});
                        var labelOrigText = unit.guide.y.label.text || unit.guide.y.label._original_text;
                        unit.guide.y.label.text = [labelOrigText]
                            .concat(_(currLayers).map(self.extractLabel))
                            .join(', ');

                        if (settings.mode === 'dock') {
                            unit.guide.y.label.padding -= 15;
                            unit.guide.y.padding += 15;
                            unit.guide.y.rotate = (-90);
                            unit.guide.y.textAnchor = 'middle';
                        }
                    }

                    if (self.isLeafElement(unit, parent)) {

                        unit.color = self.fieldColorScale;
                        unit.expression.operator = 'groupBy';
                        unit.expression.params = [self.fieldColorScale];
                        pluginsSDK
                            .unit(unit)
                            .addTransformation('slice-layer', {key: fullSpec.getScale(unit.y).dim});
                    }

                    if (self.isFinalCoordNode(unit)) {

                        unit.guide.y.label = (unit.guide.y.label || {});
                        var labelText = unit.guide.y.label.text || unit.guide.y.label._original_text;

                        if (settings.mode === 'dock') {
                            unit.guide.padding.l += totalPad;
                            unit.guide.y.label.textAnchor = 'end';
                            unit.guide.y.label.dock = 'right';
                            unit.guide.y.label.padding = -10;
                            unit.guide.y.label.cssClass = 'label inline';

                            if (self.isFacet) {
                                unit.guide.y.label.text = labelText;
                            }
                        }

                        if (settings.mode === 'merge') {
                            unit.guide.y.label.text = (self.isFacet ?
                                '' :
                                ([labelText]
                                    .concat(_(currLayers).map(self.extractLabel))
                                    .join(', ')));
                        }
                    }
                    return memo;
                };
            },

            createSecondaryUnitReducer: function (fullSpec, xLayer, totalPad, totalDif, i) {

                var self = this;

                return function (memo, unit, parent) {

                    if (self.isFacet && self.isFirstCoordNode(unit, parent)) {
                        unit.guide.y.label.text = '';
                        unit.guide.x.hide = true;
                        unit.guide.y.hide = true;
                    }

                    if (self.isLeafElement(unit, parent)) {
                        unit.type = ELEMENT_TYPE[xLayer.type];
                        unit.y = self.getScaleName(xLayer.y);
                        unit.color = self.fieldColorScale;
                        unit.expression.operator = 'groupBy';
                        var params;
                        if (_.isArray(xLayer.y)) {
                            unit.expression.params = ['subLayer'];
                            params = {group: 'subLayer'};
                        } else {
                            unit.expression.params = [self.fieldColorScale];
                            params = {key: xLayer.y};
                        }

                        pluginsSDK
                            .unit(unit)
                            .addTransformation('slice-layer', params);
                    }

                    var isFinalCoord = self.isFinalCoordNode(unit);
                    if (isFinalCoord) {
                        unit.y = self.getScaleName(xLayer.y);
                        unit.guide.y.label = (unit.guide.y.label || {});
                        unit.guide.y.label.text = self.extractLabel(xLayer);
                        unit.guide.x.hide = true;

                        if (settings.mode === 'dock') {
                            unit.guide.showGridLines = '';
                            unit.guide.padding.l += totalPad;
                            unit.guide.y.label.textAnchor = 'end';
                            unit.guide.y.label.dock = 'right';
                            unit.guide.y.label.padding = -10;
                            unit.guide.y.label.cssClass = 'label inline';
                            unit.guide.y.padding += ((totalDif + 10) * (i + 1));
                        }

                        if (settings.mode === 'merge') {
                            unit.guide.showGridLines = '';
                            unit.guide.y.hide = true;
                        }
                    }

                    return memo;
                };
            },

            getScaleName: function (layerY) {
                return (_.isArray(layerY)) ? layerY.join(', ') : layerY;
            },

            extractLabel: function (layer) {
                var g = layer.guide || {};
                g.label = (_.isString(g.label) ? {text: g.label} : g.label);
                var l = (g.label || {});

                if (_.isArray(layer.y)) {
                    return layer.y.join(', ');
                }

                return ((l.text) || (l._original_text) || layer.y);
            },

            onSpecReady: function (chart, specRef) {

                var self = this;

                var fullSpec = pluginsSDK.spec(specRef);

                if (!settings.showLayers || !self._isApplicable) {
                    fullSpec.unit().traverse(function (unit, parentUnit) {
                        if (self.isLeafElement(unit, parentUnit)) {
                            pluginsSDK
                                .unit(unit)
                                .addTransformation('defined-only', {key: fullSpec.getScale(unit.y).dim});
                        }
                    });
                    return;
                }

                fullSpec = settings
                    .layers
                    .reduce(function (memo, layer) {
                        var scaleName = self.getScaleName(layer.y);
                        return memo.addScale(
                            scaleName,
                            _.extend(
                                {type: 'linear', source: '/', dim: scaleName, autoScale: true},
                                (_.pick(layer.guide || {}, 'min', 'max', 'autoScale'))));
                    }, fullSpec);

                var currLayers = settings.layers;
                var prevUnit = fullSpec.unit();
                var cursor;
                var totalDif = (30);
                var correction = self.isFacet ? 0 : totalDif;
                var totalPad = (currLayers.length * totalDif) - correction;

                var currUnit = self
                    .buildLayersLayout(fullSpec)
                    .addFrame({
                        key: {x: 1, y: 1},
                        units: [
                            (cursor = pluginsSDK
                                .unit(prevUnit.clone()))
                                .reduce(self.createPrimaryUnitReducer(fullSpec, currLayers, totalPad), cursor)
                                .value()
                        ]
                    });

                currLayers.reduce(function (specUnitObject, layer, i) {

                    return specUnitObject.addFrame({
                        key: {x: 1, y: 1},
                        units: [
                            (cursor = pluginsSDK
                                .unit(prevUnit.clone()))
                                .reduce(self.createSecondaryUnitReducer(fullSpec, layer, totalPad, totalDif, i), cursor)
                                .value()
                        ]
                    });
                }, currUnit);
            },

            onUnitsStructureExpanded: function () {

                var self = this;

                if (self._isApplicable && (settings.mode === 'merge')) {

                    var primaryY = self.primaryY.scaleName;
                    var scaleNames = _(settings.layers)
                        .map(function (layer) {
                            return self.getScaleName(layer.y);
                        })
                        .concat(primaryY);

                    var hashBounds = scaleNames.reduce(function (memo, yi) {
                            var info = self._chart.getScaleInfo(yi);
                            memo[yi] = info.domain().filter(function (n) {
                                return !isNaN(n) && _.isNumber(n);
                            });
                            return memo;
                        },
                        {});

                    var minMax = d3.extent(_(hashBounds).chain().values().flatten().value());
                    var fullSpec = pluginsSDK.spec(self._chart.getSpec());

                    scaleNames.forEach(function (y) {
                        var yScale = fullSpec.getScale(y);
                        yScale.min = minMax[0];
                        yScale.max = minMax[1];
                        yScale.autoScale = false;
                    });
                }
            },

            // jscs:disable maximumLineLength
            containerTemplate: '<div class="graphical-report__trendlinepanel"></div>',
            template: _.template([
                '<label class="graphical-report__trendlinepanel__title graphical-report__checkbox">',
                '   <input type="checkbox"',
                '          class="graphical-report__checkbox__input i-role-show-layers"',
                '          <%= (showLayers ? "checked" : "") %>',
                '   />',
                '   <span class="graphical-report__checkbox__icon"></span>',
                '   <span class="graphical-report__checkbox__text"><%= title %></span>',
                '</label>',

                '<div>',
                '<select class="i-role-change-mode graphical-report__select graphical-report__trendlinepanel__control">',
                '   <option <%= ((mode === "dock")  ? "selected" : "") %> value="dock">Dock</option>',
                '   <option <%= ((mode === "merge") ? "selected" : "") %> value="merge">Merge</option>',
                '</select>',
                '</div>',

                '<div class="graphical-report__trendlinepanel__error-message"><%= error %></div>'
            ].join('')),
            // jscs:enable maximumLineLength

            onRender: function () {

                if (this._isApplicable && settings.showPanel) {
                    this._container.innerHTML = this.template({
                        title: 'Layers',
                        mode: settings.mode,
                        error: this._error,
                        showLayers: settings.showLayers
                    });
                }
            }
        };
    }

    tauCharts.api.plugins.add('layers', layers);

    return layers;
});
// jscs:enable *