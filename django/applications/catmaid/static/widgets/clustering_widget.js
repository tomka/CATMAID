
var ClusteringWidget = new function()
{
    var self = this;
    var content_div_id = 'clustering_content';
    var workspace_pid;

    /**
     * Creates the base URL, needed for all clustering requests and
     * appends the passed string to it. The combined result is returned.
     */
    this.get_clustering_url = function( sub_url ) {
        return django_url + 'clustering/' + self.workspace_pid + sub_url;
    };

    this.render_to_content = function( container, url, patch )
    {
        // display the clustering selection
        requestQueue.register(url,
            'GET', undefined,
            function(status, data, text) {
                if (status !== 200) {
                    alert("The server returned an unexpected status (" + status + ") " + "with error message:\n" + text);
                } else {
                    container.innerHTML = "<p>" + data + "</p>";
                    // patch the data if requested
                    if (patch)
                    {
                        patch( container );
                    }
                }
            });
    }

    this.patch_clustering_setup = function( container )
    {
        var form = $("#clustering-setup-form", container);
        var found = form.length !== 0;
        if (found) {
            form.submit(function(){
                $.ajax({
                    type: "POST",
                    url: form.attr('action'),
                    data: form.serialize(),
                    success: function(data, textStatus) {
                        container.innerHTML = "<p>" + data + "</p>";
                        ClusteringWidget.patch_clustering_setup( container );
                    }
                });
                return false;
            });
        }
    }

    this.render_clustering = function(distance_matrix)
    {
        // If the "clustering-graph" div is available, try to to draw
        // a hierarchical clustering graph.
        var container = $("#clustering-graph");
        var found = container.length !== 0;
        if (found) {
            container = container[0];
            // get dendrogram data
            var dendrogram = self.create_dendrogram(distrance_matrix);
            // create Raphael canvas
            var canvas = document.createElement('div');
            canvas.setAttribute("id", "clustering-canvas");
            canvas.style.width = "800px";
            canvas.style.height = "600px";
            container.appendChild(canvas);
            var r = new Raphael("clustering-canvas");
            // add axes
            var c = r.circle(50,40,10);
            c.attr("fill", "#f00");
            c.attr("stroke", "#fff");
        }
    };

    /**
     * Uses the distance matrix to create a cluster hierarchy. The elements
     * with the lowest distance to each other is the first cluster. The next
     * step is to create a new distance matrix where the elements of the first
     * cluster will be treated as one element. How the new distances are
     * calculated depends on the linkage: With maximum linkage, the distance
     * to an element is the maximum distance one of the cluster's elements has
     * to it. Then the process is repeated.
     */
    this.create_dendrogram = function(distrance_matrixi)
    {
    };

    this.init = function()
    {
        if (workspace_pid)
            self.refresh();
    }

    /**
     * Changes the workspace according to the value of the radio
     * buttons
     */
    this.change_workspace = function(pid, force)
    {
        if (pid != self.workspace_pid || force) {
            // Check if the container is available and only load
            // the data if it is.
            if ($('#' + content_div_id).length > 0) {
                self.workspace_pid = pid;
                self.refresh();
            }
        }
    };

    this.refresh = function(completionCallback)
    {
        var container = document.getElementById(content_div_id);

        // get the view from Django
        container.innerHTML = "<p>Please select the features that should be used for clustering.</p>";
        ClusteringWidget.render_to_content(container,
            self.get_clustering_url('/setup'), self.patch_clustering_setup);
    };
}
