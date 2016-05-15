var d3 = require('d3')
  , chroma = require('chroma-js')
  , mousetrap = require('mousetrap')
  , debounce = require('debounce')
  , resize = require('./resize')

var root = document.getElementById('colony')
  , colony = window.colony

var nodes = colony.nodes
  , links = colony.links
  , scale = colony.scale
  , focus

var width = 600
  , height = 400
  , margin = { horizontal: 100, vertical: 50 }
  , link
  , node
  , text

var colors = {
      links: 'FAFAFA'
    , text: {
        subtitle: 'FAFAFA'
    }
    , nodes: {
        method: function(d) {
            return groups[d.group].color
        }
        , hover: 'FAFAFA'
        , dep: '252929'
    }
}

var readme = document.getElementById('readme-contents').innerHTML

// hack to help see what modules are only used by web workers
links = links.filter(l => (nodes[l.target].id !== 'worker.js'))
links.push({
  source: nodes.findIndex(n => n.id === 'map.js'),
  target: nodes.findIndex(n => n.id === 'worker.js'),
  hidden: true
})

links.forEach(function(link) {
    var source = nodes[link.source]
      , target = nodes[link.target]

    source.children = source.children || []
    source.children.push(link.target)

    target.parents = target.parents || []
    target.parents.push(link.source)
})

var groupDepth = 2
function groupByFocus() {
  // first get each node's minDepth from root nodes
  nodes.filter(n => n.root).forEach(function (f, i, arr) { mark(f, f.id, 0) })
  nodes.forEach(n => {
    n.minDepth = d3.min(d3.values(n._sources))
    delete n._sources
  })

  // now, nodes that are at groupDepth as the grouping roots
  var colorScale = chroma.scale('Spectral')
  var groupColors = {}
  nodes.filter(n => (n.minDepth === groupDepth)).forEach(function (n, i, arr) {
    mark(n, n.id, 0)
    groupColors[n.id] = colorScale(i / arr.length)
    console.log('%c' + n.id, 'color: ' + groupColors[n.id].hex())
  })
  nodes.filter(n => (n.minDepth < groupDepth)).forEach(function (n) {
    n._sources = { root: 0 }
    groupColors.root = colorScale(1)
  })

  var roots = nodes.filter(n => (n.minDepth === groupDepth || n.minDepth === 0))
  for (var i = 0; i < roots.length; i++) {
    for (var j = i + 1; j < roots.length; j++) {
      links.push({ source: roots[i], target: roots[j], hidden: true })
    }
  }

  var groups = nodes.reduce(function (groups, file) {
    var group = Object.keys(file._sources).sort().join('-')
    var index = groups.indexOf(group)
    if (index === -1) {
      index = groups.length
      groups.push(group)
    }
    file.group = index
    return groups
  }, [])

  ;[].concat(groups).sort().forEach(g => {
    if (groupColors[g]) { return }
    var colors = g.split('-').map(id => groupColors[id])
    var color = colors[0]
    for (var i = 1; i < colors.length; i++) {
      color = chroma.mix(color, colors[i], 1 - i / colors.length, 'lab')
    }
    groupColors[g] = color
  })

  return groups.map(g => ({name: g, color: groupColors[g]}))

  function mark (node, source, depth, stack) {
    if (!stack) { stack = [] }
    if (stack.indexOf(node.id) >= 0) { return }
    stack = stack.concat([node.id])
    if (!node._sources) { node._sources = {} }
    var sources = node._sources
    // otherwise, mark the depth and recurse
    sources[source] = Math.max(depth, sources[source] || 0)
    if (node.children) {
      depth += 1
      node.children.map(i => nodes[i]).forEach(child => mark(child, source, depth, stack))
    }
  }
}

var groups = groupByFocus()

function resetForce () {
    return this.charge(function (d) { return d.fixed ? 0 : -10 * d.id.length * colony.scale })
    .linkDistance(function (d) {
      var mult
      if (d.source.minDepth === groupDepth && d.target.minDepth === groupDepth) {
        mult = 30
      } else if (d.target.group !== d.source.group) {
        mult = 10
      } else {
        mult = 5
      }
      return mult * (d.target.id.length + d.source.id.length) * colony.scale
    })
    .linkStrength(function (d) {
      if (d.source.minDepth < groupDepth || d.target.minDepth < groupDepth) {
        return 0
      }
      return d.source.group === d.target.group ? 1 : 0.125
    })
}

var force = d3.layout.force()
resetForce.call(force)
    .size([width, height])
    .on('tick', function() {
        link.attr('x1', function(d) { return bounded(d.source.x, width); })
            .attr('y1', function(d) { return bounded(d.source.y, height); })
            .attr('x2', function(d) { return bounded(d.target.x, width); })
            .attr('y2', function(d) { return bounded(d.target.y, height); })

        node.attr('transform', function (d) {
          return 'translate(' + bounded(d.x, width) + ',' + bounded(d.y, height) + ')'
        })

        function bounded (t, max) { return Math.min(Math.max(t, 0), max) }
    })

var vis = d3.select(root)
    .append('svg')
    .attr('width', width + margin.vertical)
    .attr('height', height + margin.horizontal)
    .append('g')
    .attr('transform', 'translate(' + margin.horizontal / 2 + ',' + margin.vertical / 2 + ')')

force.nodes(nodes)
     .links(links)
     .start()

link = vis.selectAll('line.link').data(links)
node = vis.selectAll('g.node')
    .data(nodes, function(d) { return d.filename })

link.enter()
    .insert('line', '.node')
    .attr('class', 'link')
    .attr('x1', function(d) { return d.source.x; })
    .attr('y1', function(d) { return d.source.y; })
    .attr('x2', function(d) { return d.target.x; })
    .attr('y2', function(d) { return d.target.y; })
    .style('stroke', colors.links)
    .style('opacity', function(d) {
        return d.hidden ? 0 : 0.3
    })


var nodeEnter = node.enter()
    .append('g')
    .attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')' })
    .attr('class', 'node')
    .call(force.drag)
    .on('mouseover', function(d) {
        console.log(d.id, groups[d.group], d)
        d3.select(this).select('circle')
          .style('fill', colors.nodes.hover)
        d3.selectAll(childNodes(d)).select('circle')
            .style('fill', colors.nodes.hover)
            .style('stroke', colors.nodes.method)
            .style('stroke-width', 2)
        d3.selectAll(parentNodes(d)).select('circle')
            .style('fill', colors.nodes.dep)
            .style('stroke', colors.nodes.method)
            .style('stroke-width', 2)
    })
    .on('mouseout', function(d) {
        d3.select(this).select('circle')
          .style('fill', colors.nodes.method)
        d3.selectAll(childNodes(d)).select('circle')
            .style('fill', colors.nodes.method)
            .style('stroke', null)
        d3.selectAll(parentNodes(d)).select('circle')
            .style('fill', colors.nodes.method)
            .style('stroke', null)
    })
    .on('click', function(d) {
        if (focus === d) {
            resetForce.call(force).start()

            node.style('opacity', 1)
            link.style('opacity', function(d) {
                return d.target.module ? 0.2 : 0.3
            })

            focus = false

            d3.select(root)
              .classed('showing-code', false)
            if (readme) {
              d3.select('#readme-contents')
                .html(readme)
            }

            return
        }

        focus = d

        d3.xhr('./files/' + d.filename + '.html', function(res) {
            if (!res) return

            d3.select('#readme-contents')
              .html(res.responseText)
            d3.select('#readme')
              .classed('showing-code', true)

            document.getElementById('readme')
                    .scrollTop = 0
        })

        node.style('opacity', function(o) {
            o.active = connected(d, o)
            return o.active ? 1 : 0.2
        })

        force.charge(function(o) {
            return (o.active ? -100 : -5) * colony.scale
        }).linkDistance(function(l) {
            return (l.source.active && l.target.active ? 100 : 20) * colony.scale
        }).linkStrength(function(l) {
            return (l.source === d || l.target === d ? 1 : 0) * colony.scale
        }).start()

        link.style('opacity', function(l, i) {
            return l.source.active && l.target.active ? 0.2 : 0.02
        })
    })

nodeEnter.append('circle')
    .attr('class', 'node')
    .attr('r', function(d) {
        return scale * ((d.minDepth === groupDepth || d.minDepth === 0) ? 12 : 5)
    })
    .style('fill', colors.nodes.method)

nodeEnter.append('text')
    .attr('class', 'nodetext')
    .attr('text-anchor', 'middle')
    .attr('dy', -10)
    .text(function (d) { return d.id })

function refresh(e) {
    width = Math.max(window.innerWidth, 500) - margin.horizontal
    height = window.innerHeight - margin.vertical

    force.size([width, height])
         .resume()

     d3.select(root).select('svg')
       .attr('width', width + margin.horizontal).attr('height', height + margin.vertical)
};

function childNodes(d) {
    if (!d.children) return []

    return d.children
        .map(function(child) {
            return node[0][child]
        }).filter(function(child) {
            return child
        })
};

function parentNodes(d) {
    if (!d.parents) return []

    return d.parents
        .map(function(parent) {
            return node[0][parent]
        }).filter(function(parent) {
            return parent
        })
};

function connected(d, o) {
    return o.index === d.index ||
        (d.children && d.children.indexOf(o.index) !== -1) ||
        (o.children && o.children.indexOf(d.index) !== -1) ||
        (o.parents && o.parents.indexOf(d.index) !== -1) ||
        (d.parents && d.parents.indexOf(o.index) !== -1)
};

function restartForce() {
    var theta = force.theta()

    force.start()
         .theta(theta)
};

resize(debounce(refresh, 500))
refresh()

mousetrap.bind(['~', '`'], function() {
    var readme = d3.select('#readme')

    readme.classed('enlarged', !readme.classed('enlarged'))
})
