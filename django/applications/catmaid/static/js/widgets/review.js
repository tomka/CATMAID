/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  CATMAID
*/

(function(CATMAID) {

  "use strict";

  CATMAID.ReviewSystem = new function()
  {
    var projectID, skeletonID, subarborNodeId;
    var self = this;
    self.skeleton_segments = null;
    self.current_segment = null;
    self.current_segment_index = 0;
    var end_puffer_count = 0,
      autoCentering = true,
      followedUsers = [];
    // Set to true, if one moves beyond the current segment
    self.movedBeyondSegment = false;
    // Set to true, if one deselects the current skeleton
    self.segmentUnfocused = false;
    // Set to true, if no auto-refresh should happen after a segment has been
    // rully reviewed.
    self.noRefreshBetwenSegments = false;
    // Default reference orientation to XY
    self.referenceOrientation = Stack.ORIENTATION_XY;
    // Specify step size for skipping consecutive virtual nodes
    self.virtualNodeStep = 1;
    // Keep track of last virtual node step, if any
    var skipStep = null;


    this.init = function() {
      projectID = project.id;
      followedUsers = [session.userid];
      // Default reference orientation to currently focused stack
      if (project.focusedStack) {
        self.referenceOrientation = project.focusedStack.orientation;
      }
    };

    this.setAutoCentering = function(centering) {
      autoCentering = centering ? true : false;
    };

    this.getAutoCentering = function() {
      return autoCentering;
    };

    this.validSegment = function() {
      return self.current_segment !== null;
    };

    /**
     * Return true if the reference orientation implies looking parallel to X.
     * False otherwise.
     */
    this.isXView = function() {
      return this.referenceOrientation === Stack.ORIENTATION_ZY;
    };

    /**
     * Return true if the reference orientation implies looking parallel to Y.
     * False otherwise.
     */
    this.isYView = function() {
      return this.referenceOrientation === Stack.ORIENTATION_XZ;
    };

    /**
     * Return true if the reference orientation implies looking parallel to Z.
     * False otherwise.
     */
    this.isZView = function() {
      return this.referenceOrientation === Stack.ORIENTATION_XY;
    };

    /**
     * Return the depth component of the current reference orientation.
     */
    this.getDepthField = function() {
      if (this.isZView()) return 'z';
      else if (this.isYView()) return 'y';
      else if (this.isXView()) return 'x';
      else throw new CATMAID.ValueError('Unknown reference orientation');
    };

    /**
     * If the active skeleton changes, the review system will register it. The
     * widget will make sure the view is centered at the last active node, when
     * review is continued.
     */
    this.handleActiveNodeChange = function(node) {
      var segment = this.current_segment ? this.current_segment['sequence'] : null;
      var index = this.current_segment_index;
      // If there is an active segment and no node is selected anymore or the
      // node change, mark the current segment as unfocused.
      if (segment && (!node || segment[index].id !== node.id) &&
          (!skipStep || skipStep.id !== node.id)) {
        this.segmentUnfocused = true;
      }
    };

    /**
     * Remove all review state information and clear content.
     */
    this.endReview = function() {
      self.skeleton_segments = null;
      self.current_segment = null;
      self.current_segment_index = 0;
      if( $('#review_segment_table').length > 0 ) $('#review_segment_table').remove();
      $('#reviewing_skeleton').text('');
      $('#counting-cache').text('');
      $('#counting-cache-info').text('');
    };

    /**
     * Start review of a specific segment, regardless of whether it has already
     * been reviewed.
     *
     * @param {number} id - The index of the segment, 0-based.
     */
    this.initReviewSegment = function( id ) {
      // Reset movement flags
      this.segmentUnfocused = false;
      this.movedBeyondSegment = false;
      // Select and move to start of segment
      self.current_segment = self.skeleton_segments[id];
      self.current_segment_index = 0;
      self.goToNodeIndexOfSegmentSequence(0, true);
      end_puffer_count = 0;
      // Highlight current segment in table
      var $rows = $('table#review_segment_table tr.review-segment');
      $rows.removeClass('highlight');
      var $cur_row = $rows.filter('tr[data-sgid=' + id + ']');
      $cur_row.addClass('highlight');
    };

    /**
     * Move to the a specific node of the segment currently under review.
     */
    this.goToNodeIndexOfSegmentSequence = function(idx, forceCentering) {
      if (self.skeleton_segments===null)
        return;
      var node = self.current_segment['sequence'][idx];
      this.goToNodeOfSegmentSequence(node, forceCentering);
    };

    /**
     * Move to the a specific node of the segment currently under review.
     */
    this.goToNodeOfSegmentSequence = function(node, forceCentering) {
      if (self.skeleton_segments===null)
        return;
      var center = autoCentering || forceCentering;
      SkeletonAnnotations.staticMoveTo(
        (self.isZView() || center) ? node.z : project.coordinates.z,
        (self.isYView() || center) ? node.y : project.coordinates.y,
        (self.isXView() || center) ? node.x : project.coordinates.x,
        function () {
           SkeletonAnnotations.staticSelectNode( node.id, skeletonID );
        });
    };

    this.moveNodeInSegmentBackward = function() {
      if (null === self.skeleton_segments) {
        return;
      }

      var sequence = self.current_segment['sequence'];

      if (!skipStep) self.markAsReviewed(sequence[self.current_segment_index]);

      // By default, the selected node is changed and centering not enforced.
      var changeSelectedNode = true;
      var forceCentering = false;

      // Don't change the selected node, if moved out of the segment
      if (self.movedBeyondSegment) {
        self.movedBeyondSegment = false;
        changeSelectedNode = false;
      }
      // Don't change the selected node, but force centering, if the current
      // segment became unfocused.
      if (self.segmentUnfocused) {
        self.segmentUnfocused = false;
        changeSelectedNode = false;
        forceCentering = true;
      }

      if (changeSelectedNode) {
        if(self.current_segment_index > 0 || skipStep) {
          var ln, cn, newIndex = self.current_segment_index - 1;
          if (skipStep) {
            ln = skipStep;
            // If the existing skipping step was created with the current node
            // as source, the current test node needs to be the virtual node.
            if (skipStep.to !== sequence[newIndex]) {
              newIndex = self.current_segment_index;
            }
          } else {
            ln = sequence[self.current_segment_index];
          }
          cn = sequence[newIndex];
          // If the distance between the (new) current node and the node before it
          // is above the maximum step distance, an intermediate step will be
          // taken to force the user to better sample larger distances. If such a
          // sample step has already been taken before, this step is the reference
          // point for the distance test. Steps are sections in the currently
          // focused stack.
          skipStep = self.limitMove(ln, cn, true);
          if (skipStep) {
            // Move to skipping step
            this.goToNodeOfSegmentSequence(skipStep, forceCentering);
            return;
          } else {
            self.current_segment_index = newIndex;
          }

          self.warnIfNodeSkipsSections();
        }
        self.goToNodeIndexOfSegmentSequence(self.current_segment_index, forceCentering);
      } else {
        // Go to 'previous' section, to check whether an end really ends
        self.lookBeyondSegment(sequence, forceCentering);
      }
    };

    /**
     * Return a skipping step, if there is one required when moving from node 1
     * to node 2. If no step is required, null is returned.
     */
    this.limitMove = function(ln, cn, backwards) {
      var vP = [cn.x - ln.x, cn.y - ln.y, cn.z - ln.z];
      // Get difference vector in stack space coordinates and check that not
      // more sections are crossed than allowed.
      var stack = project.focusedStack;
      var vPAbs = [Math.abs(vP[0]), Math.abs(vP[1]), Math.abs(vP[2])];
      var vSAbs = [stack.projectToStackX(vPAbs[2], vPAbs[1], vPAbs[0]),
                   stack.projectToStackY(vPAbs[2], vPAbs[1], vPAbs[0]),
                   stack.projectToStackZ(vPAbs[2], vPAbs[1], vPAbs[0])];
      // If the stack space Z distance is larger than the virtual node step
      // value, stop at the section that is reachable with this value.
      if (vSAbs[2] > self.virtualNodeStep) {
        // Get project space coordinate of intermediate point, move to it and
        // select a virtual node there.
        var zS = stack.z + self.virtualNodeStep * (vP[2] > 0 ? 1 : -1);
        var vnID = backwards ?
          SkeletonAnnotations.getVirtualNodeID(cn.id, ln.id, zS) :
          SkeletonAnnotations.getVirtualNodeID(ln.id, cn.id, zS);
        var zRatio = self.virtualNodeStep / vSAbs[2];
        return {
          id: vnID,
          x: ln.x + vP[0] * zRatio,
          y: ln.y + vP[1] * zRatio,
          z: ln.z + vP[2] * zRatio,
          stack: stack,
          to: cn
        };
      } else {
        return null;
      }
    };

    /**
     * Move one section beyond a segment's leaf.
     */
    this.lookBeyondSegment = function(segment, forceCentering) {
      if (0 === segment.length) return;

      var depthField = this.getDepthField();
      var i = 1;
      while (i < segment.length && segment[i-1][depthField] === segment[i][depthField]) {
        i += 1;
      }
      if (i === segment.length) {
        // corner case
        CATMAID.msg("Can't move", "Can't decide whether to move " +
            "forward or backward one section!");
        return;
      }
      self.movedBeyondSegment = true;
      // Will check stack boundaries at Stack.moveTo
      var coords;
      if (this.autoCentering || forceCentering) {
        coords = {x: segment[0].x, y: segment[0].y, z: segment[0].z};
      } else {
        coords = {x: project.coordinates.x, y: project.coordinates.y,
           z: project.coordinates.z};
      }
      var inc = segment[i-1][depthField] - segment[i][depthField];
      coords[depthField] = segment[0][depthField] + inc;
      project.moveTo(coords.z, coords.y, coords.x);
    };

    this.moveNodeInSegmentForward = function(advanceToNextUnfollowed) {
      if (self.skeleton_segments===null)
        return;

      var sequence = self.current_segment['sequence'];
      var sequenceLength = sequence.length;

      // Mark current node as reviewed, if this is no intermediate step.
      if (!skipStep) {
        //  Don't wait for the server to respond
        self.markAsReviewed( sequence[self.current_segment_index] );

        if( self.current_segment_index === sequenceLength - 1  ) {
          if (self.noRefreshBetwenSegments) {
            end_puffer_count += 1;
            // do not directly jump to the next segment to review
            if( end_puffer_count < 3) {
              CATMAID.msg('DONE', 'Segment fully reviewed: ' +
                  self.current_segment['nr_nodes'] + ' nodes');
              return;
            }
            // Segment fully reviewed, go to next without refreshing table
            // much faster for smaller fragments
            markSegmentDone(selg.current_segment, [session.userid])
            self.selectNextSegment();
            return;
          } else {
            self.startSkeletonToReview(skeletonID, subarborNodeId);
            return;
          }
        }
      }

      var changeSelectedNode = true;
      var forceCentering = false;
      // Don't change the selected node, if moved out of the segment before
      if (self.movedBeyondSegment) {
        self.movedBeyondSegment = false;
        changeSelectedNode = false;
      }
      // Don't change the selected node, but force centering, if the current
      // segment became unfocused.
      if (self.segmentUnfocused) {
        self.segmentUnfocused = false;
        changeSelectedNode = false;
        forceCentering = true;
      }

      if (changeSelectedNode) {

        var whitelist = CATMAID.ReviewSystem.Whitelist.getWhitelist();
        var reviewedByTeam = reviewedByUserOrTeam.bind(self, whitelist);

        var newIndex = self.current_segment_index + 1;
        if (advanceToNextUnfollowed) {
          // Advance current_segment_index to the first node that is not reviewed
          // by the current user or any review team member.
          var i = newIndex;
          while (i < sequenceLength) {
            if (!seq[i].rids.some(reviewedByTeam)) {
              newIndex = i;
              break;
            }
            i += 1;
          }
        }

        // If the distance between the (new) current node and the node before it
        // is above the maximum step distance, an intermediate step will be
        // taken to force the user to better sample larger distances. If such a
        // sample step has already been taken before, this step is the reference
        // point for the distance test. Steps are sections in the currently
        // focused stack.
        var ln, cn;
        if (skipStep) {
          ln = skipStep;
          if (skipStep.to !== sequence[newIndex]) {
            newIndex = Math.min(self.current_segment_index + 1, sequenceLength - 1);
          }
        } else {
          ln = sequence[newIndex - 1];
        }
        cn = sequence[newIndex];

        skipStep = self.limitMove(ln, cn, false);
        if (skipStep) {
          // Move to skipping step
          this.goToNodeOfSegmentSequence(skipStep, forceCentering);
          return;
        } else {
          self.current_segment_index = newIndex;
        }

        if (self.current_segment_index < sequenceLength -1) {
          // Check if the remainder of the segment was complete at an earlier time
          // and perhaps now the whole segment is done:
          var i_user = self.current_segment_index;
          var i_union = self.current_segment_index;
          while (i_user < sequenceLength && sequence[i_user].rids.some(reviewedByTeam)) {
            i_user += 1;
          }
          while (i_union < sequenceLength && 0 !== sequence[i_union].rids.length) {
            i_union += 1;
          }
          var cellIDs = [];
          if (i_user === sequenceLength) {
            cellIDs.push(session.userid);
            CATMAID.msg('DONE', 'Segment fully reviewed: ' +
                self.current_segment['nr_nodes'] + ' nodes');
          }
          if (i_union === sequenceLength) cellIDs.push('union');
          if (cellIDs.length > 0) markSegmentDone(self.current_segment, cellIDs);
          // Don't startSkeletonToReview, because self.current_segment_index
          // would be lost, losing state for q/w navigation.
        }

        self.warnIfNodeSkipsSections();
      }

      // Select the (potentially new) current node
      self.goToNodeIndexOfSegmentSequence(self.current_segment_index, forceCentering);
    };

    /**
     * Set the segment status to 100% and reflect this in the table cells
     * identified with cellIDs.
     */
    function markSegmentDone(segment, cellIDs) {
      cellIDs.forEach(function(s) {
        var cell = $('#rev-status-cell-' + segment['id'] + '-' + s);
        cell.text('100.00%');
        cell.css('background-color', CATMAID.ReviewSystem.STATUS_COLOR_FULL);
      });

      segment['status'] = '100.00';
    }

    /**
     * Tests if a review was reviewd by the current user
     */
    function reviewedByUser(review)
    {
      return session.userid === review[0];
    }

    /**
     * Test if a review was done by the current user or a review team member.
     */
    function reviewedByUserOrTeam(team, review)
    {
      if (reviewedByUser(review)) return true;
      if (review[0] in team) {
        var rDate = new Date(review[1]);
        return rDate >= team[review[0]];
      }
      return false;
    }

    /**
     * Create a warning message if the distance between the current and the last
     * node (or last skipping step) is larger than what is allowed to be
     * skipped.
     */
    this.warnIfNodeSkipsSections = function () {
      if (0 === self.current_segment_index) {
        return;
      }
      var cn = self.current_segment.sequence[self.current_segment_index];
      var ln = skipStep ? skipStep :
        self.current_segment.sequence[self.current_segment_index - 1];
      var zdiff = project.focusedStack.projectToStackZ(
          cn.z - ln.z, cn.y - ln.y, cn.x - ln.x);
      if (Math.abs(zdiff) > self.virtualNodeStep) {
        CATMAID.msg("Skipped sections", "This node is " + Math.abs(zdiff) +
            " sections away from the previous node.", {style: 'warning'});
      }
    };

    var submit = typeof submitterFn!= "undefined" ? submitterFn() : undefined;

    /**
     * Mark the given node as reviewed in the back-end.
     */
    this.markAsReviewed = function( node_ob ) {
      submit(django_url+projectID+"/node/" + node_ob['id'] + "/reviewed", {},
          function(json) {
            if (json.reviewer_id) {
              // Append the new review to the list of reviewers of
              // this node, if not already present.
              var lastIndex;
              var known = node_ob['rids'].some(function(r, i) {
                lastIndex = i;
                return r[0] === json.reviewer_id;
              });

              // Either update an existing entry or create a new one
              var reviewInfo = [json.reviewer_id, json.review_time];
              if (known) {
                node_ob['rids'][lastIndex] = reviewInfo;
              } else {
                node_ob['rids'].push(reviewInfo);
              }
            }
          });
    };

    /**
     * Selects the next segment to review, that is the first segment that
     * wasn't reviewed by either the current user or one that is followed. To
     * check the review state of all segments, we want to make sure all requests
     * returned from the server (otherwise we don't work with the most recent
     * information). Therefore, the selection of the next segment is queued to
     * be executed after all pending requests.
     */
    this.selectNextSegment = function() {
      // Reset skipping step, if any
      skipStep = null;
      // Find nexte segment
      if (self.skeleton_segments) {
        var fn = function() {
          var nSegments = self.skeleton_segments.length;

          // Find out the start index to search for the next one from.
          // This either the index of the current element or zero if the
          // element is not found (or not available).
          var fromIndex = 0;
          if (self.current_segment) {
            fromIndex = self.skeleton_segments.indexOf(self.current_segment) + 1;
            if (fromIndex === nSegments) {
              fromIndex = 0;
            }
          }

          // Find a segment with unreviewed nodes, starting after current segment
          var nextSegmentIndex = -1;
          for (var i=0; i<nSegments; i++)
          {
            // Get index of next segment, starting from current segment
            var segmentIndex = (fromIndex + i) % nSegments;
            var nodes = self.skeleton_segments[segmentIndex].sequence;
            // Check if the next segment has unreveviewed nodes
            if (nodes.some(isUnreviewed)) {
              nextSegmentIndex = segmentIndex;
              break;
            }
          }

          // Select next segment, if any. Otherwise show finishing
          // message.
          if (nextSegmentIndex >= 0) {
            self.initReviewSegment(nextSegmentIndex);
          } else {
            CATMAID.msg("Done", "Done reviewing.");
          }

          /**
           * Support function to test whether a node hasn't been reviewed by
           * any of the followed reviewers. This is the case if the list of
           * reviewers is empty or no followed reviewer appears in it.
           */
          function isUnreviewed(node) {
            return 0 === node['rids'].length || followedUsers.every(function(rid) {
              return !node['rids'].some(function(r) {
                return rid === r[0];
              });
            });
          }
        };

        var errFn = function() {
          CATMAID.msg("Error", "Couldn't select next segment for " +
            "review, please try again!");
        };

        // Queue the selection so that pending requests can finish before.
        // Display an error message if something fails before.
        submit(null, null, fn, false, false, errFn);
      }
    };

    /**
     * Clears the table with ID 'review_segment_table' prior to adding rows to
     * it. If a subarborNodeId is given, not the whole skeleton will be
     * reviewed, but only the sub-arbor starting at the given node ID. If
     * omitted or null it will default to the root node.
     * */
    this.createReviewSkeletonTable = function( skeleton_data, users, subarborNodeId ) {
      self.skeleton_segments = skeleton_data;
      var butt, table, tbody, row;
      if( $('#review_segment_table').length > 0 ) {
        $('#review_segment_table').remove();
      }

      // Count which user reviewed how many nodes and map user ID vs object
      // containing name and count.
      // FIXME: count is wrong because branch points are repeated. Would have
      // to create sets and then count the number of keys.
      var users = users.reduce(function(map, u) {
        // Create an empty segment count object
        var seg_count = skeleton_data.reduce(function(o, s) {
          o[s.id] = 0;
          return o;
        }, {});
        // Create a new count object for this user
        map[u[0]] = {name: u[1], count: 0, segment_count: seg_count};
        return map;
      }, {});

      // Make a pseudo-user that aggregates reviews from the whitelist.
      var whitelistUser = {name: 'Team', count: 0,
          segment_count: skeleton_data.reduce(function(o, s) {
            o[s.id] = 0;
            return o;
          }, {})};
      var whitelist = CATMAID.ReviewSystem.Whitelist.getWhitelist();

      // Fill in the users count:
      skeleton_data.forEach(function(segment) {
        segment['sequence'].forEach(function(node) {
          var whitelisted = false;

          node['rids'].forEach(function(rid) {
            var userId = rid[0], reviewTime = new Date(rid[1]);
            users[userId].count += 1;
            users[userId].segment_count[segment.id] += 1;

            if (!whitelisted && userId in whitelist && reviewTime > whitelist[userId]) {
              whitelistUser.count += 1;
              whitelistUser.segment_count[segment.id] += 1;
              whitelisted = true; // Whitelist each node only once.
            }
          });
        });
      });
      // Create a list of all users who have reviewed this neuron. Add the
      // current user as first element, regardless of his/her review status.
      var reviewers = Object.keys(users).filter(function(u) {
        // u is a string, so rely on != for comparing to (integer) user ID.
        return this[u].count > 0 && u != session.userid;
      }, users);
      // Prepend user ID
      reviewers = [session.userid].concat(reviewers);
      // Make sure all IDs are actual numbers
      reviewers = reviewers.map(function(u){ return parseInt(u); });

      // Append whitelist to users and reviewers
      if (reviewers.length > 1) {
        users.whitelist = whitelistUser;
        reviewers.push('whitelist');
      }

      // Create string with user's reviewed counts:
      var user_revisions = reviewers.reduce(function(s, u) {
        u = users[u];
        s += u.name + ": " + u.count + "; ";
        return s;
      }, "");

      $('#reviewing_skeleton').text( 'Skeleton ID under review: ' + skeletonID + " -- " + user_revisions );
      table = $('<table />').attr('cellpadding', '3').attr('cellspacing', '0').attr('id', 'review_segment_table').attr('border', '0');
      // create header
      row = $('<tr />');
      row.append($('<th />'));
      // Start with user columns, current user first
      for (var i=0; i<reviewers.length; ++i) {
        var cb = $('<input />').attr('type', 'checkbox')
          .attr('data-rid', reviewers[i])
          .attr('title', "When checked, column will be respected when next segment is selected.")
          .click(function() {
           var rid = parseInt($(this).attr('data-rid'));
           var idx = followedUsers.indexOf(rid);
           if (-1 !== idx && !this.checked) {
            // Remove from follower list if in list and the name was
            // unchecked.
            followedUsers.splice(idx, 1);
           } else if (-1 === idx && this.checked) {
            // Add to follower list if not already there and the name
            // was checked.
            followedUsers.push(rid);
           }
          });
        if (-1 !== followedUsers.indexOf(reviewers[i])) {
          cb.prop('checked', true);
        }
        row.append( $('<th />').append($('<label />')
          .append(cb).append(users[reviewers[i]].name)));
      }
      // Union column last
      if (reviewers.length > 2) {
        row.append( $('<th />').text('Union') );
      }
      table.append( row );
      row.append( $('<th />').text("# nodes"));
      row.append($('<th />'));
      table.append( row );
      // create a row
      for(var e in skeleton_data ) {
        var sd = skeleton_data[e];
        row = $('<tr />')
          .attr('class', 'review-segment')
          .attr('data-sgid', sd.id);
        // Index
        row.append( $('<td />').text(skeleton_data[e]['id'] ) );
        // Single user status
        if (reviewers.length > 2) {
          // The reviewers array contains oneself as first element
          reviewers.forEach(function(r) {
            var seg_status = (100 * users[r].segment_count[sd.id] /
                sd.nr_nodes).toFixed(2);
            this.append($('<td />').text(seg_status + '%')
                .attr('id', 'rev-status-cell-' + sd.id + '-' + r)
                .css('background-color',
                    CATMAID.ReviewSystem.getBackgroundColor(Math.round(seg_status))));
          }, row);
        }
        // Union status
        var status = $('<td />')
            .attr('id', 'rev-status-cell-' + sd.id + '-union')
            .text( skeleton_data[e]['status']+'%' )
            .css('background-color',
                CATMAID.ReviewSystem.getBackgroundColor(parseInt(sd.status)));
        row.append( status );
        // Number of nodes
        row.append( $('<td align="right" />').text( skeleton_data[e]['nr_nodes'] ) );
        // Review button
        butt = $('<button />').text( "Review" );
        butt.attr( 'id', 'reviewbutton_'+skeleton_data[e]['id'] );
        butt.click( function() {
          self.initReviewSegment( this.id.replace("reviewbutton_", "") );
        });
        row.append( $('<td />').append(butt) );
        table.append( row );
      }
      // empty row
      row = $('<tr />');
      table.append( row );
      table.append( $('<br /><br /><br /><br />') );
      $("#project_review_widget").append( table );

    };

    var checkSkeletonID = function() {
      if (!skeletonID) {
        CATMAID.msg('BEWARE', 'You need to activate a skeleton to review.');
        return false;
      }
      return true;
    };

    this.startReviewActiveSkeleton = function(subarborOnly) {
      var skid = SkeletonAnnotations.getActiveSkeletonId();
      var subarborNodeId = undefined; // jshint ignore:line
      if (subarborOnly) {
        subarborNodeId = SkeletonAnnotations.getActiveNodeId();
      }
      this.startSkeletonToReview( skid, subarborNodeId );
    };

    this.startSkeletonToReview = function( skid, nodeId ) {
      if (!skid) {
        CATMAID.error('No skeleton ID provided for review.');
        return;
      } else {
        skeletonID = skid;
        subarborNodeId = nodeId;
      }
      if (!checkSkeletonID()) {
        return;
      }

      // empty caching text
      $('#counting-cache').text('');

      submit(django_url + "accounts/" + projectID + "/all-usernames", {},
        function(usernames) {
          submit(django_url + projectID + "/skeleton/" + skeletonID + "/review",
            {'subarbor_node_id': subarborNodeId},
            function(skeleton_data) {
                self.createReviewSkeletonTable( skeleton_data, usernames );
            });
        });

    };

    var resetFn = function(fnName) {
      if (!checkSkeletonID()) {
        return;
      }
      if (!confirm("Are you sure you want to alter the review state of skeleton #" + skeletonID + " with '" + fnName + "' ?")) {
        return;
      }
      submit(django_url+projectID+"/skeleton/" + skeletonID + "/review/" + fnName, {},
        function(json) {
          self.startReviewActiveSkeleton();
        });
    };

    this.resetOwnRevisions = function() {
      resetFn("reset-own");
    };

    var loadImageCallback = function (container, name, queuedTiles, cachedTiles) {
      $(container).text(name + ': ' + cachedTiles + '/' + (cachedTiles + queuedTiles));
    };

    this.cacheImages = function() {
      if (!checkSkeletonID()) {
        return;
      }
      var startsegment = -1, endsegment = 0, locations = [];

      for(var idx in self.skeleton_segments) {
        if( self.skeleton_segments[idx]['status'] !== "100.00" ) {
          if( startsegment == -1)
            startsegment = idx;
          var seq = self.skeleton_segments[idx]['sequence'];
          for(var i = 0; i < self.skeleton_segments[idx]['nr_nodes']; i++ ) {
            if(!seq[i]['rids'].some(reviewedByUser)) {
              locations.push([seq[i].x, seq[i].y, seq[i].z]);
            }
          }
          endsegment = idx;
        }
        if (locations.length > 500)
          break;
      }

      $('#counting-cache-info').text( 'From segment: ' + startsegment + ' to ' + endsegment );
      var counterContainer = $('#counting-cache');
      counterContainer.empty();
      project.getStacks().forEach(function(stack) {
        var tilelayer = stack.getLayers()['TileLayer'];
        // Create loading information text for each stack
        var layerCounter = document.createElement('div');
        counterContainer.append(layerCounter);
        if (tilelayer) {
          tilelayer.cacheLocations(locations,
              loadImageCallback.bind(self, layerCounter, stack.title));
        }
      });
    };
  }();

  // Register to the active node change event
  SkeletonAnnotations.on(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
    CATMAID.ReviewSystem.handleActiveNodeChange, CATMAID.ReviewSystem);

  CATMAID.ReviewSystem.STATUS_COLOR_FULL    = '#6fff5c';
  CATMAID.ReviewSystem.STATUS_COLOR_PARTIAL = '#ffc71d';
  CATMAID.ReviewSystem.STATUS_COLOR_NONE    = '#ff8c8c';

  /**
   * Support function for selecting a background color based on review state.
   */
  CATMAID.ReviewSystem.getBackgroundColor = function(reviewed) {
    if (100 === reviewed) {
    return CATMAID.ReviewSystem.STATUS_COLOR_FULL;
    } else if (0 === reviewed) {
    return CATMAID.ReviewSystem.STATUS_COLOR_NONE;
    } else {
    return CATMAID.ReviewSystem.STATUS_COLOR_PARTIAL;
    }
  };

  CATMAID.ReviewSystem.Whitelist = (function () {
    var whitelist = {};

    return {
      /**
       * Returns a copy of the internal whitelist.
       */
      getWhitelist: function () {
      return $.extend(true, {}, whitelist);
      },

      /**
       * Adds a reviewer to the whitelist, optionally specifying a time after
       * which their reviews are accepted. Adding a user already in the
       * whitelist will overwrite this time.
       */
      addReviewer: function (userId, acceptAfter) {
      // Default acceptAfter to effectively accept all reviews by setting to
      // the UNIX time epoch.
      if (typeof acceptAfter === 'undefined') acceptAfter = new Date(+0);
      // Coerce other date representations into Date objects
      else if (!(acceptAfter instanceof Date)) {
        acceptAfter = new Date(acceptAfter);
        if (isNaN(acceptAfter.getTime())) {
          CATMAID.msg('ERROR', 'Accept after date is invalid');
          return this;
        }
      }

      if (!(userId in User.all())) {
        CATMAID.msg('ERROR', 'Reviewer does not have a valid user ID');
        return this;
      }

      // Add new reviewer to whitelist
      whitelist[userId] = acceptAfter;

      return this;
      },

      /**
       * Removes a reviewer from the whitelist.
       */
      removeReviewer: function (userId) {
      delete whitelist[userId];

      return this;
      },

      /**
       * Retrieves the whitelist from the server.
       */
      refresh: function (callback) {
      // If no project is open or no user is logged in, clear the whitelist.
      if (typeof project === 'undefined' || typeof session === 'undefined') {
        whitelist = {};
        return;
      }

      requestQueue.register(
          django_url + project.id + '/user/reviewer-whitelist',
          'GET',
          undefined,
          CATMAID.jsonResponseHandler(function (json) {
            whitelist = json.reduce(function (wl, entry) {
              wl[entry.reviewer_id] = new Date(entry.accept_after);
              return wl;
            }, {});
            if (typeof callback === 'function') callback();
          }));
      },

      /**
       * Saves the current state of the whitelist to the server.
       */
      save: function (callback) {
      // If no user is logged in, do not attempt to save the whitelist.
      if (typeof session === 'undefined') return;

      var encodedWhitelist = Object.keys(whitelist).reduce(function (ewl, userId) {
        ewl[userId] = whitelist[userId].toISOString();
        return ewl;
      }, {});
      requestQueue.replace(
          django_url + project.id + '/user/reviewer-whitelist',
          'POST',
          encodedWhitelist,
          callback,
          'reviewerwhitelist' + project.id);
      }
    };
  })();
})(CATMAID);
