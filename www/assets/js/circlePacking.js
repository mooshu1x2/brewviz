$("#404").hide();
define(['assets/third_party/elasticsearch-js/elasticsearch'], function(elasticsearch) {
    "use strict";

    $(document).ready(function() {

        $('#search').keyup(function(e) {
            // Update circlepack Viz
            if (e.keyCode == 13) {
                genQuery();
            }
        });

        $('.search').change(function(e) {
            // Update circlepack Viz
            genQuery();
        })

        $('#range-abv').range({
            min: 1,
            max: 55,
            start: 1,
            onChange: function(value) {
                genQuery();
            },
            input: '#range-abv-value'
        });

        $('#range-abv-value').keyup(function(e) {
            if (e.keyCode == 13) {
                $('#range-abv').range('set value', $(this).val());
                // Update circlepack viz
                genQuery();
            }
        });

        genQuery();

    });


    var client = new elasticsearch.Client({
        host: 'http://localhost:9200'
    })

    function setupParams(input) {
        var aggregations = {
            categories: {
                terms: {
                    field: "style.category.name.raw",
                    exclude: "", // exclude empty strings.
                    size: 20
                },
                aggs: {
                    styles: {
                        terms: {
                            field: "style.name.raw",
                            exclude: "", // exclude empty strings.
                            size: 20 // limit to top 5 styles per cateogry. 
                        },
                        aggs: {
                            sample: {
                                sampler: {
                                    shard_size: 20
                                },
                                aggs: {
                                    beer: {
                                        terms: {
                                            field: "nameDisplay.raw",
                                            exclude: "",
                                            size: 20
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        var searchParams = {
            index: 'brew',
            size: 0,
            body: {
                query: input,
                aggs: aggregations
            }
        }

        return searchParams;
    };

    function genQuery() {
        var term = $('#search').val();
        var query;

        if (term !== '') {
            query = {
                bool: {
                    must: {
                        multi_match: {
                            query: term,
                            type: "best_fields",
                            fields: ["name", "nameDisplay", "style.category.name", "style.name", "style.description", "description", "foodPairings"]
                        }
                    },
                    filter: {
                        range: {
                            "abv": {
                                from: $('#range-abv-value').val(),
                                to: 55
                            }
                        }
                    }
                }
            };
        } else {
            query = {
                bool: {
                    must: {
                        match_all: {}
                    },
                    filter: {
                        range: {
                            "abv": {
                                from: $('#range-abv-value').val(),
                                to: 55
                            }
                        }
                    }
                }
            };
        }
        execute(query);
    }

    function execute(query) {
        client.search(setupParams(query), function(err, resp) {
            if (err) {
                $("#404").text(err);
            }
            d3.select("svg").remove();
            if (resp.hits.total !== 0) {
                $("#404").hide();
                var root = createChildNodes(resp);
                draw(root);
            } else {
                // Show Empty results div
                $("#404").show();
            }
        });
    }
});

function createChildNodes(dataObj) {
    var root = {};
    root.key = "";
    root.children = dataObj.aggregations.categories.buckets;
    root.children.forEach(function(d) { d.children = d.styles.buckets; });
    root.children.forEach(function(d) {
        d.children.forEach(function(d) {
            d.sample.beer.buckets.forEach(function(d, i) {
                d.doc_count = 1;
            });
            d.children = d.sample.beer.buckets;
        });
    });
    return root;
}

var categoryTitle = { 'default': 'Beer Categories and Styles', 'style': 'Beer Styles', 'name': 'Beer' };
var categoryId = ['default', 'style.category.name', 'style.name', 'nameDisplay'];
var mappings = { 'style.category.name': 'style.category', 'style.name': 'style', 'nameDisplay': 'name' };
var categoryData = { 'style.category': ['name'], 'style': ['name', 'description', "abvMin", "abvMax"], 'name': ['name', 'description', 'isOrganic'] };

function draw(root) {
    var rect = document.getElementById("circlePacking").getBoundingClientRect();
    var width = rect.width + 100;
    var diameter = width;

    var svg = d3.select("#circlePacking").append("svg")
        .attr("width", width)
        .attr("height", 800)
        .append("g")
        .attr("transform", "translate(" + diameter / 2 + "," + diameter / 2 + ")");

    var color = d3.scaleLinear()
        .domain([-1, 3])
        // .range(["hsl(24, 33%, 18%)", "hsl(37, 72%, 89%)"])
        .range(["hsl(19,51%,43%)", "hsl(50,68%,53%)"])
        .interpolate(d3.interpolateHcl);

    margin = 20;

    var pack = d3.pack()
        .size([diameter - margin, diameter - margin])
        .padding(2);

    root = d3.hierarchy(root)
        .sum(function(d) {
            return d.doc_count;
        })
        .sort(function(a, b) {
            return b.value - a.value;
        });

    var focus = root,
        nodes = pack(root).descendants(),
        view;

    var circle = d3.select("g").selectAll("circle")
        .data(nodes)
        .enter().append("circle")
        .attr("id", function(d) {
            return d.data.key;
        })
        .attr("class", function(d) {
            return d.parent ? d.children ? "node" : "node node--leaf" : "node node--root";
        })
        .style("fill", function(d) {
            return d.children ? color(d.depth) : null;
        })
        .on("dblclick", function(d) {
            if (focus !== d & d.depth !== 3) {
                zoom(d);
                d3.event.stopPropagation();
            }
        })
        .on("click", function(d) {
            var key = d3.select(this).attr('id');
            var id = categoryId[d.depth];

            // Just need to filter the leaf nodes for search request
            var gp = null;
            var p = null;

            if (d.height == 0) {
                // Depth 3, leaf node
                gp = d.parent.parent.data.key;
                p = d.parent.data.key;
            }

            lookup(id, key, gp, p);
        });

    var text = d3.select("g").selectAll("text")
        .data(nodes)
        .enter().append("text")
        .attr("class", "label")
        .style("fill-opacity", function(d) {
            return d.parent === root ? 1 : 0;
        })
        .style("display", function(d) {
            return d.parent === root ? "inline" : "none";
        })
        .text(function(d) {
            return d.data.key;
        });

    var node = d3.select("g").selectAll("circle,text");

    svg.style("background", color(-1))
        .on("dblclick", function() { zoom(root); });

    zoomTo([root.x, root.y, root.r * 2 + margin]);

    function zoom(d) {
        var focus0 = focus;
        focus = d;

        var transition = d3.transition()
            .duration(d3.event.altKey ? 7500 : 750)
            .tween("zoom", function(d) {
                var i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2 + margin]);
                return function(t) { zoomTo(i(t)); };
            });

        transition.selectAll("text")
            .filter(function(d) {
                if (typeof d !== 'undefined') {
                    return d.parent === focus || this.style.display === "inline";
                }
            })
            .style("fill-opacity", function(d) {
                return d.parent === focus ? 1 : 0;
            })
            .on("start", function(d) {
                if (d.parent === focus) this.style.display = "inline";
            })
            .on("end", function(d) {
                if (d.parent !== focus) this.style.display = "none";
            });
    }

    function zoomTo(v) {
        var k = diameter / v[2];
        view = v;
        node.attr("transform", function(d) {
            return "translate(" + (d.x - v[0]) * k + "," + (d.y - v[1]) * k + ")";
        });
        circle.attr("r", function(d) {
            return d.r * k;
        });
    }
}

function lookup(id, key, gp, p) {

    // Build filter query
    var filter = []
    if (gp !== null) {
        if (gp !== "") {
            filter1 = { "term": { "style.category.name.raw": gp } };
            filter.push(filter1);
        }
    }

    if (p !== null) {
        if (p !== "") {
            filter2 = { "term": { "style.name.raw": p } };
            filter.push(filter2);
        }
    }

    var query = {
        'size': 1,
        'query': {
            'bool': {
                'must': [{
                    'match': {
                        [id]: key
                    }
                }],
                'filter': filter
            }
        }
    };

    clearAll();

    if (key !== '') {
        var prefix = mappings[id];

        $.ajax({
                method: "POST",
                url: "http://localhost:9200/brew/_search?pretty=true",
                crossDomain: true,
                data: JSON.stringify(query),
                dataType: 'json',
                contentType: 'application/json',
            })
            .done(function(data) {
                var res = data.hits;
                if (prefix == 'style.category') {
                    buildCategory(res);
                } else if (prefix == 'style') {
                    buildStyle(res);
                } else if (prefix == 'name') {
                    buildBeer(res);
                } else {
                    buildDefault();
                }
            })
            .fail(function(data) {});
    } else {
        buildDefault();
    }
}

function clearAll() {
    $("#title").html("");
    $("#description").html("");
    $("table").hide();
    $(".default").hide();
    $("#content").hide();
}

function buildCategory(res) {
    $("#content").show();
    $("#title").html(res.hits[0]._source.style.category.name);
    $("#description").html("");
    $("#category .total").html(res.total);
    $("#category").show();
}

function buildStyle(res) {
    $("#content").show();
    $("table").hide();
    $("#title").html(res.hits[0]._source.style.name);
    $("#description").html(res.hits[0]._source.style.description);
    $("#style .total").html(res.total);

    var abvMin = abvMax = "&infin;";
    if (typeof res.hits[0]._source.style.abvMin !== 'undefined') {
        abvMin = res.hits[0]._source.style.abvMin;
    }
    if (typeof res.hits[0]._source.style.abvMax !== 'undefined') {
        abvMax = res.hits[0]._source.style.abvMax;
    }
    var abv = abvMin + "% - " + abvMax + "%";

    var ibuMin = ibuMax = "&infin;";
    if (typeof res.hits[0]._source.style.ibuMin !== 'undefined') {
        ibuMin = res.hits[0]._source.style.ibuMin;
    }
    if (typeof res.hits[0]._source.style.ibuMax !== 'undefined') {
        ibuMax = res.hits[0]._source.style.ibuMax;
    }
    var ibu = ibuMin + " - " + ibuMax;

    var ogMin = ogMax = "&infin;";
    if (typeof res.hits[0]._source.style.ogMin !== 'undefined') {
        ogMin = res.hits[0]._source.style.ogMin;
    }
    if (typeof res.hits[0]._source.style.ogMax !== 'undefined') {
        ogMax = res.hits[0]._source.style.ogMax;
    }
    var og = ogMin + " - " + ogMax;

    var fgMin = fgMax = "&infin;";
    if (typeof res.hits[0]._source.style.fgMin !== 'undefined') {
        fgMin = res.hits[0]._source.style.fgMin;
    }
    if (typeof res.hits[0]._source.style.fgMax !== 'undefined') {
        fgMax = res.hits[0]._source.style.fgMax;
    }
    var fg = fgMin + " - " + fgMax;

    $("#style .rangeabv").html(abv);
    $("#style .rangeibu").html(ibu);
    $("#style .rangeog").html(og);
    $("#style .rangefg").html(fg);
    $("#style").show();
}

function buildBeer(res) {
    $("#content").show();
    $("table").hide();
    $("#title").html(res.hits[0]._source.nameDisplay);
    $("#description").html(res.hits[0]._source.description);
    $("#beer .organic").html(res.hits[0]._source.isOrganic);
    var abv = "Unknown";
    if (typeof res.hits[0]._source.abv !== 'undefined') {
        abv = res.hits[0]._source.abv;
    }
    $("#beer .abv").html(abv);

    var ibu = "Unknown";
    if (typeof res.hits[0]._source.ibu !== 'undefined') {
        ibu = res.hits[0]._source.ibu;
    }
    $("#beer .ibu").html(ibu);

    $("#beer .brewery").html('<a href="' + res.hits[0]._source.breweries[0].website + '">' + res.hits[0]._source.breweries[0].name + '</a>');
    var glass = "Unknown";
    if (typeof res.hits[0]._source.glass !== 'undefined') {
        glass = res.hits[0]._source.glass.name;
    }
    $("#beer .glass").html(glass);

    var location = "";

    // Locality and region might not be defined 
    if (typeof res.hits[0]._source.breweries !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations[0].region !== 'undefined') {
        location = res.hits[0]._source.breweries[0].locations[0].region;
    }

    if (typeof res.hits[0]._source.breweries !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations[0].country !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations[0].country.displayName !== 'undefined') {
        location = location + " " + res.hits[0]._source.breweries[0].locations[0].country.displayName
    }

    if (typeof res.hits[0]._source.breweries !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations !== 'undefined' &&
        typeof res.hits[0]._source.breweries[0].locations[0].locality !== 'undefined') {
        location = res.hits[0]._source.breweries[0].locations[0].locality + ", " + location;
    }

    $("#beer .location").html(location);

    // Serving Temperature
    var st = "Unknown";
    if (typeof res.hits[0]._source.servingTemperatureDisplay !== 'undefined') {
        st = res.hits[0]._source.servingTemperatureDisplay;
    }

    $("#beer .st").html(st);

    // Food Pairings
    var food = "Unknown";
    if (typeof res.hits[0]._source.foodPairings !== 'undefined') {
        food = res.hits[0]._source.foodPairings;
    }

    $("#beer .fp").html(food);

    // Ingredients

    // Hops
    var hops = "Unknown";
    if (typeof res.hits[0]._source.ingredients !== 'undefined' &&
        typeof res.hits[0]._source.ingredients.hops !== 'undefined') {
        hops = []
        var hopsArray = res.hits[0]._source.ingredients.hops;
        $.each(hopsArray, function(index, value) {
            hops.push(value.name);
        });
        hops = hops.join(", ");
    }

    // Yeast 
    var yeast = "Unknown";
    if (typeof res.hits[0]._source.ingredients !== 'undefined' &&
        typeof res.hits[0]._source.ingredients.yeast !== 'undefined') {
        yeast = []
        var yeastArray = res.hits[0]._source.ingredients.yeast;
        $.each(yeastArray, function(index, value) {
            yeast.push(value.name);
        });
        yeast = yeast.join(", ");
    }

    // Malt
    var malt = "Unknown";
    if (typeof res.hits[0]._source.ingredients !== 'undefined' &&
        typeof res.hits[0]._source.ingredients.malt !== 'undefined') {
        malt = []
        var maltArray = res.hits[0]._source.ingredients.malt;
        $.each(maltArray, function(index, value) {
            malt.push(value.name);
        });
        malt = malt.join(", ");
    }

    // Misc
    var misc = "Unknown";
    if (typeof res.hits[0]._source.ingredients !== 'undefined' && typeof res.hits[0]._source.ingredients.misc !== 'undefined') {
        misc = []
        var miscArray = res.hits[0]._source.ingredients.misc;
        $.each(miscArray, function(index, value) {
            misc.push(value.name);
        });
        misc = misc.join(", ");
    }

    $("#beer .hops").html(hops);
    $("#beer .yeast").html(yeast);
    $("#beer .malt").html(malt);
    $("#beer .misc").html(misc);

    $("#beer").show();
}

function buildDefault() {
    $(".default").show();
}
