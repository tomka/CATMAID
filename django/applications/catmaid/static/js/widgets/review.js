/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  CATMAID
*/

(function(CATMAID) {

  "use strict";

  CATMAID.ReviewSystem = function() {
    this.widgetID = this.registerInstance();
    this.projectId = null;
    this.currentSkeletonId = null;
    this.currentSubarborNodeId = null;
    var self = this;
    self.mode = 'node-review';
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
    // fully reviewed.
    self.noRefreshBetwenSegments = false;
    // Specify step size for skipping consecutive virtual nodes
    self.virtualNodeStep = 1;
    // Keep track of last virtual node step, if any
    var skipStep = null;
    // Review towards root by default
    self.reviewUpstream = true;
    // Review updates are made persistent, by default
    self.persistReview = true;

    // A set of filter rules to apply to the handled skeletons
    this.filterRules = [];
    // Filter rules can optionally be disabled
    this.applyFilterRules = true;
    // A set of nodes allowed by node filters
    this.allowedNodes = new Set();

    this.init = function() {
      this.projectId = project.id;
      followedUsers = [CATMAID.session.userid, 'whitelist'];
      this.redraw();
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
      return project.focusedStackViewer.primaryStack.orientation ===
        CATMAID.Stack.ORIENTATION_ZY;
    };

    /**
     * Return true if the reference orientation implies looking parallel to Y.
     * False otherwise.
     */
    this.isYView = function() {
      return project.focusedStackViewer.primaryStack.orientation ===
          CATMAID.Stack.ORIENTATION_XZ;
    };

    /**
     * Return true if the reference orientation implies looking parallel to Z.
     * False otherwise.
     */
    this.isZView = function() {
      return project.focusedStackViewer.primaryStack.orientation ===
          CATMAID.Stack.ORIENTATION_XY;
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
      var $rows = $('table#review_segment_table tr.review-segment');
      $rows.removeClass('active');

      // Ignore this node change if no segment is under review at the moment
      if (!this.skeleton_segments) return;
      var segment = this.current_segment ? this.current_segment['sequence'] : null;
      var rNode = !!segment ? segment[this.current_segment_index] : null;

      if (node) {
        var nodeId = node.id;
        if (!SkeletonAnnotations.isRealNode(node.id)) {
          // Force re-focus on next step if the newly active virtual node is not
          // on the edge between parent and child.
          var pID = SkeletonAnnotations.getParentOfVirtualNode(node.id);
          var cID = SkeletonAnnotations.getChildOfVirtualNode(node.id);
          nodeId = pID;
          if (rNode && rNode.id != pID && rNode.id != cID) {
            this.segmentUnfocused = true;
          }
        } else if (rNode && node.id != rNode.id) {
          // Force re-focus on next step if the new active node is not the
          // node currently under review.
          this.segmentUnfocused = true;
        }

        // Find and highlight segment rows containing the active node.
        var activeSegmentIds = this.skeleton_segments
            .filter(function (seg) {
              return seg.sequence.some(function (n) {
                return n.id === nodeId;
              });})
            .map(function (seg) { return seg.id; });
        $rows.filter('[data-sgid="' + activeSegmentIds.join('"],[data-sgid="') + '"]').addClass('active');
      } else if (rNode) {
        // Force re-focus on next step if there is no active node anymore.
        this.segmentUnfocused = true;
      }
    };

    /**
     * Remove all review state information and clear content.
     */
    this.endReview = function() {
      skipStep = null;
      self.currentSkeletonId = null;
      self.currentSubarborNodeId = null;
      self.skeleton_segments = null;
      self.current_segment = null;
      self.current_segment_index = 0;
      if( $('#review_segment_table').length > 0 ) $('#review_segment_table').remove();
      $('#reviewing_skeleton').text('');
      $('#counting-cache').text('');
      $('#counting-cache-info').text('');
      if (this.nodeReviewContainer) {
        this.nodeReviewContainer.style.display = 'none';
      }
    };

    /**
     * Start review of a specific segment, regardless of whether it has already
     * been reviewed.
     *
     * @param {number} id - The index of the segment, 0-based.
     */
    this.initReviewSegment = function( id ) {
      skipStep = null;
      // Reset movement flags
      this.segmentUnfocused = false;
      this.movedBeyondSegment = false;
      // Select and move to start of segment
      self.current_segment = self.skeleton_segments[id];
      self.current_segment_index = this.reviewUpstream ?
          0 : (this.current_segment.sequence.length - 1);
      self.goToNodeIndexOfSegmentSequence(this.current_segment_index, true);
      end_puffer_count = 0;
      // Highlight current segment in table
      var $rows = $('table#review_segment_table tr.review-segment');
      $rows.removeClass('highlight');
      var $cur_row = $rows.filter('tr[data-sgid=' + id + ']');
      $cur_row.addClass('highlight');
    };

    /**
     * Move to a specific node of the segment currently under review.
     */
    this.goToNodeIndexOfSegmentSequence = function(idx, forceCentering) {
      if (self.skeleton_segments===null)
        return;
      var node = self.current_segment['sequence'][idx];
      this.goToNodeOfSegmentSequence(node, forceCentering);
    };

    /**
     * Move to a specific node of the segment currently under review.
     */
    this.goToNodeOfSegmentSequence = function(node, forceCentering) {
      if (self.skeleton_segments===null)
        return;
      var center = autoCentering || forceCentering;
      SkeletonAnnotations.staticMoveTo(
          (self.isZView() || center) ? node.z : project.coordinates.z,
          (self.isYView() || center) ? node.y : project.coordinates.y,
          (self.isXView() || center) ? node.x : project.coordinates.x)
      .then(function () {
        SkeletonAnnotations.staticSelectNode( node.id, self.currentSkeletonId );
      })
      .catch(CATMAID.handleError);
    };

    this.moveNodeInSegmentBackward = function(advanceToNextUnfollowed) {
      return this.moveToNextNode(advanceToNextUnfollowed, false);
    };

    /**
     * Get the current team whitelist and add all followed users.
     */
    this.getCurrentWhiteListAndFollowed = function() {
      var whitelist = -1 !== followedUsers.indexOf('whitelist') ?
          CATMAID.ReviewSystem.Whitelist.getWhitelist() : {};
      for (var i=0; i<followedUsers.length; ++i) {
        var reviewerId = followedUsers[i];
        if (reviewerId !== 'whitelist') {
          whitelist[reviewerId] = new Date(0);
        }
      }
      return whitelist;
    };

    /**
     * Iterate over sequene and check if each node is reviewed, ignoring all
     * nodes listed in in <ignoredIndices>.
     */
    this.isSegmentFullyReviewed = function(sequence, ignoredIndices) {
      var whitelist = this.getCurrentWhiteListAndFollowed();
      var reviewedByTeam = reviewedByUserOrTeam.bind(self, CATMAID.session.userid, whitelist);
      var nUnreviewedNodes = 0;
      for (var i=0; i<sequence.length; ++i) {
        var reviewed = sequence[i].rids.some(reviewedByTeam);
        var ignored = false;
        if (ignoredIndices) {
          ignored = ignoredIndices.indexOf(i) !== -1;
        }
        if (!reviewed && !ignored) {
          ++nUnreviewedNodes;
        }
      }

      return nUnreviewedNodes === 0;
    };

    /**
     * Move to the next node in the current segment and mark the current node as
     * reviewed. Depending on <upstream>, this can either be in the upstream
     * direction or the downstream direction.
     */
    this.moveToNextNode = function(advanceToNextUnfollowed, upstream) {
      if (self.skeleton_segments===null)
        return;

      var sequence = self.current_segment['sequence'];
      var sequenceLength = sequence.length;

      var isLastNode = upstream ?
        self.current_segment_index === sequenceLength - 1 :
        self.current_segment_index === 0;

      // Mark current node as reviewed, if this is no intermediate step.
      if (!skipStep) {
        //  Don't wait for the server to respond
        self.markAsReviewed(sequence, self.current_segment_index)
          .then(updateReviewStatus.bind(window, self.current_segment, [CATMAID.session.userid, 'union']))
          .catch(CATMAID.handleError);

        var noSegmentMove = false;

        if (this.isSegmentFullyReviewed(sequence, [self.current_segment_index])) {
          CATMAID.msg('Done', 'Segment fully reviewed: ' +
              self.current_segment['nr_nodes'] + ' nodes');

          // If the last node of a segment is reached, move to next segment if
          // not disabled.
          if (isLastNode) {
            if (self.noRefreshBetwenSegments || !self.persistReview) {
              end_puffer_count += 1;
              // do not directly jump to the next segment to review
              if( end_puffer_count < 3) {
                return;
              }
              // Segment fully reviewed, go to next without refreshing table
              // much faster for smaller fragments
              self.selectNextSegment();
            } else {
              self.startSkeletonToReview(self.currentSkeletonId, self.currentSubarborNodeId);
            }
            noSegmentMove = true;
          }
        }

        // If moving in downstream direction, it is possible to look beyond the
        // last node. This is done to check if the segment 'end' is an eactual
        // end.
        if (!upstream && isLastNode) {
          self.lookBeyondSegment(sequence, forceCentering);
          noSegmentMove = true;
        }

        if (noSegmentMove) {
          return;
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
        var whitelist = this.getCurrentWhiteListAndFollowed();
        var reviewedByTeam = reviewedByUserOrTeam.bind(self, CATMAID.session.userid, whitelist);

        // Find index of next real node that should be reviewed
        var newIndex = upstream ?
            Math.min(self.current_segment_index + 1, sequenceLength - 1) :
            Math.max(self.current_segment_index - 1, 0);

        if (advanceToNextUnfollowed) {
          // Advance index to the first node that is not reviewed by the current
          // user or any review team member.
          var i = newIndex;
          if (upstream) {
            while (i < sequenceLength) {
              if (!sequence[i].rids.some(reviewedByTeam)) {
                newIndex = i;
                break;
              }
              i += 1;
            }
          } else {
            while (i > 0) {
              if (!sequence[i].rids.some(reviewedByTeam)) {
                newIndex = i;
                break;
              }
              i -= 1;
            }
          }
        }

        var ln, refIndex;
        if (skipStep) {
          ln = skipStep;
          refIndex = skipStep.refIndex;
          // If the existing skipping step was created with the current node
          // as source, the current test node needs to be the virtual node.
          if (skipStep.to !== sequence[newIndex]) {
            newIndex = upstream ? skipStep.refIndex : (skipStep.refIndex - 1);
          }
        } else {
          refIndex = newIndex;
          ln = upstream ? sequence[newIndex - 1] : sequence[newIndex + 1];
        }

        var nn = sequence[newIndex];

        // Check if an intermediate step is required. If a sample step has
        // already been taken before, this step is the reference point for the
        // distance test.
        skipStep = self.limitMove(ln, nn, refIndex, !upstream);
        if (!skipStep) {
          // If a real node is next, update current segment index and check if
          // we are close to the segment end.
          self.current_segment_index = newIndex;
          self.warnIfNodeSkipsSections(ln);
        }
      }

      // Select the (potentially new) current node
      if (skipStep) {
        self.goToNodeOfSegmentSequence(skipStep, forceCentering);
      } else {
        self.goToNodeIndexOfSegmentSequence(self.current_segment_index, forceCentering);
      }
    };

    /**
     * Return a skipping step, if there is one required when moving from node 1
     * to node 2. If no step is required, null is returned. A step is required
     * if the distance between both  above the maximum step distance. Steps are
     * sections in the currently focused stack.
     */
    this.limitMove = function(from, to, refIndex, backwards) {
      var stackViewer = project.focusedStackViewer;
      var stack = stackViewer.primaryStack;
      // Get difference vector in stack space coordinates and check that not
      // more sections are crossed than allowed. Unfortunately, we can't
      // transform vectors into stack space (due to translation being applied)
      // and so we have to transform both to and from nodes separately.
      var fromSZ = stack.projectToUnclampedStackZ(from.z, from.y, from.x);
      var toSZ = stack.projectToUnclampedStackZ(to.z, to.y, to.x);
      var zDiff = toSZ - fromSZ;
      var zDiffAbs = Math.abs(zDiff);
      var prevIndex = backwards ? (refIndex + 1) : (refIndex - 1);
      var suppressedZs = self.current_segment.sequence[prevIndex].sup.reduce(function (zs, s) {
        if (s[0] === stack.orientation) {
          var vncoord = [0, 0, 0];
          vncoord[2 - s[0]] = s[1];
          zs.push(stack.projectToStackZ(vncoord[2], vncoord[1], vncoord[0]));
        }
        return zs;
      }, []);
      var suppressedSkips = 0;
      // If the stack space Z distance is larger than the virtual node step
      // value, stop at the section that is reachable with this value.
      if (zDiffAbs > self.virtualNodeStep) {
        // Get project space coordinate of intermediate point, move to it and
        // select a virtual node there. Make sure this new section is not a
        // broken slice.
        var nSteps = 0;
        var inc = (zDiff > 0 ? 1 : -1);
        while (true) {
          // Increment step counter and check if
          ++nSteps;
          // Set new target section, based on the current number of stacks
          var targetSZ = fromSZ + nSteps * inc;
          // If the target section is a broken slice, try the next one. Check
          // this first, because we want to step to the first valid section as
          // close as possible to the limit.
          if (-1 !== stack.broken_slices.indexOf(targetSZ)) continue;
          if (-1 !== suppressedZs.indexOf(targetSZ)) {
            suppressedSkips++;
            continue;
          }
          // If we reach the section of the original target, use this instead
          if (targetSZ === toSZ) break;
          // Stop incrementing if we reached the step limit
          if (nSteps >= self.virtualNodeStep) break;
        }

        if (suppressedSkips) {
          CATMAID.warn('Skipped ' + suppressedSkips + ' suppressed virtual nodes.');
        }

        if (targetSZ === toSZ) return null;

        var zRatio = nSteps / zDiffAbs;

        // Get project space coordinates for virtual node ID
        var xp = from.x + (to.x - from.x) * zRatio;
        var yp = from.y + (to.y - from.y) * zRatio;
        var zp = from.z + (to.z - from.z) * zRatio;

        var vnID = backwards ?
          SkeletonAnnotations.getVirtualNodeID(to.id, from.id, xp, yp, zp) :
          SkeletonAnnotations.getVirtualNodeID(from.id, to.id, xp, yp, zp);

        return {
          id: vnID,
          x: xp,
          y: yp,
          z: zp,
          stack: stack,
          to: to,
          refIndex: refIndex
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
        CATMAID.msg("Can't looky beyond node", "Can't decide whether to move " +
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

      // If the second node of the current segment is on a lower index section
      // than the first one, we move beyond the segment by looking at the next
      // higher index section after the first node. Otherwise, we look at the
      // next lower index section.
      var viewer = project.focusedStackViewer;
      var stack = project.focusedStackViewer.primaryStack;
      var validDistanced = segment[i][depthField] > segment[i-1][depthField] ?
          stack.validZDistanceBefore(viewer.z) : stack.validZDistanceAfter(viewer.z);
      var targetZ = validDistanced ? viewer.z + validDistanced : viewer.z;
      // Move to location found
      project.moveTo(
          stack.stackToProjectZ(targetZ, viewer.y, viewer.x),
          stack.stackToProjectY(targetZ, viewer.y, viewer.x),
          stack.stackToProjectX(targetZ, viewer.y, viewer.x));
    };

    this.moveNodeInSegmentForward = function(advanceToNextUnfollowed) {
      return this.moveToNextNode(advanceToNextUnfollowed, true);
    };

    /**
     * Calculate the review status for a set of user IDs (including "union")
     * and reflect this in the appropriate table cells.
     */
    function updateReviewStatus(segment, reviewerIds) {
      reviewerIds.forEach(function(s) {
        var reviewedByCell = reviewedByUser.bind(self, s);
        var status = (segment.sequence.reduce(function (count, n) {
          var reviewed = s === 'union' ?
              n.rids.length !== 0 :
              n.rids.some(reviewedByCell);
          return count + (reviewed ? 1 : 0);
        }, 0) * 100.0 / segment.nr_nodes).toFixed(2);
        var cell = $('#rev-status-cell-' + segment['id'] + '-' + s);
        cell.text(status + '%')
            .css('background-color',
                 CATMAID.ReviewSystem.getBackgroundColor(Math.round(status)));
        if (s === CATMAID.session.userid) segment['status'] = status;
      });
    }

    /**
     * Tests if review response indicates a review by the given user.
     */
    function reviewedByUser(userId, review)
    {
      return userId === review[0];
    }

    /**
     * Test if a review was done by the given user or a review team member.
     */
    function reviewedByUserOrTeam(userId, team, review)
    {
      if (reviewedByUser(userId, review)) return true;
      if (team) {
        if (review[0] in team) {
          var rDate = new Date(review[1]);
          return rDate >= team[review[0]];
        }
      }
      return false;
    }

    /**
     * Show a warning message if the distance between the current node and the
     * passed in reference node (defaulting to the last node in the current
     * segment) is larger than what is allowed to be skipped.
     */
    this.warnIfNodeSkipsSections = function (referenceNode) {
      if (0 === self.current_segment_index) {
        return;
      }
      // Get current and last node
      var cn = self.current_segment.sequence[self.current_segment_index];
      var ln = referenceNode ? referenceNode :
        self.current_segment.sequence[self.current_segment_index - 1];
      // Convert to stack space to check against virtual node step limit
      var cnz = project.focusedStackViewer.primaryStack.projectToStackZ(cn.z, cn.y, cn.x);
      var lnz = project.focusedStackViewer.primaryStack.projectToStackZ(ln.z, ln.y, ln.x);
      var zdiff = cnz - lnz;
      if (Math.abs(zdiff) > self.virtualNodeStep) {
        CATMAID.msg("Skipped sections", "This node is " + Math.abs(zdiff) +
            " sections away from the previous node.", {style: 'warning'});
      }
    };

    var submit = typeof submitterFn!= "undefined" ? submitterFn() : undefined;

    var updateClientNodeReview = function(node, reviewerId, reviewTime) {
      // Append the new review to the list of reviewers of
      // this node, if not already present.
      var lastIndex;
      var known = node['rids'].some(function(r, i) {
        lastIndex = i;
        return r[0] === reviewerId;
      });

      // Either update an existing entry or create a new one
      var reviewInfo = [reviewerId, reviewTime];
      if (known) {
        node['rids'][lastIndex] = reviewInfo;
      } else {
        node['rids'].push(reviewInfo);
      }
    };

    /**
     * Mark the given node as reviewed. If review updates should be persisted,
     * this is communicated to the back-end.
     */
    this.markAsReviewed = function(segment, index) {
      return new Promise(function(resolve, reject) {
        var node = segment[index];
        if (!node) {
          throw new CATMAID.ValueError("Couldn't find node in segment");
        }

        if (self.persistReview) {
          submit(django_url + self.projectId + "/node/" + node['id'] + "/reviewed",
              'POST',
              {},
              function(json) {
                if (json.reviewer_id) {
                  updateClientNodeReview(node, json.reviewer_id, json.review_time);
                  resolve(node);
                }
              });
        } else {
          updateClientNodeReview(node, CATMAID.session.userid, new Date().toISOString());
          resolve(node);
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
      // Find next segment
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
            // Check if the next segment has unreviewed nodes
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
        submit(null, null, null, fn, false, false, errFn);
      }
    };

    /**
     * Clears the table with ID 'review_segment_table' prior to adding rows to
     * it. If a subarborNodeId is given, not the whole skeleton will be
     * reviewed, but only the sub-arbor starting at the given node ID. If
     * omitted or null it will default to the root node.
     * */
    this.createReviewSkeletonTable = function(skeleton_data, users) {
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
        return this[u].count > 0 && u != CATMAID.session.userid;
      }, users);
      // Prepend user ID
      reviewers = [CATMAID.session.userid].concat(reviewers);
      // Make sure all IDs are actual numbers
      reviewers = reviewers.map(function(u){ return parseInt(u); });

      // Append whitelist to users and reviewers
      if (reviewers.length > 1) {
        users.whitelist = whitelistUser;
        reviewers.push('whitelist');
      }

      // Create string with user's reviewed counts:
      var user_revisions = reviewers.map(function(u) {
        u = users[u];
        return u.name + ": " + u.count;
      }).join(', ');

      // Empty header and add new info
      var header = document.getElementById('reviewing_skeleton');
      while (header.firstChild) {
        header.removeChild(header.firstChild);
      }
      var neuronInfo = document.createElement('span');
      neuronInfo.classList.add('left');
      var reviewInfo = document.createElement('span');
      reviewInfo.classList.add('right');

      var neuronName = CATMAID.NeuronNameService.getInstance().getName(self.currentSkeletonId);
      neuronInfo.appendChild(document.createTextNode('Neuron under review: ' + neuronName));
      reviewInfo.appendChild(document.createTextNode('Revisions: ' + user_revisions));
      header.appendChild(neuronInfo);
      header.appendChild(reviewInfo);

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
            var rid = this.dataset.rid === 'whitelist' ?
                this.dataset.rid : parseInt(this.dataset.rid);
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
        if (self.current_segment && sd.id === self.current_segment.id) row.addClass('highlight');
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
      if (!self.currentSkeletonId) {
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
        self.currentSkeletonId = skid;
        self.currentSubarborNodeId = nodeId;
      }
      if (!checkSkeletonID()) {
        return;
      }

      submit(django_url + "accounts/" + self.projectId + "/all-usernames", "POST", {},
        function(usernames) {
          submit(django_url + self.projectId + "/skeletons/" + self.currentSkeletonId + "/review",
            "POST",
            {'subarbor_node_id': self.currentSubarborNodeId},
            function(skeleton_data) {
                self.createReviewSkeletonTable( skeleton_data, usernames );
                self.redraw();
            });
        });
    };

    var resetFn = function(fnName) {
      if (!checkSkeletonID()) {
        return;
      }
      if (!self.persistReview) {
        CATMAID.warn("Reviews are currently immutable ('Save review updates' disabled)");
        return;
      }
      $('<div id="dialog-confirm" />')
          .text('This will remove all of your reviews from this skeleton. ' +
                'This cannot be undone. Are you sure you want to continue?')
          .dialog({
            resizable: false,
            modal: true,
            title: 'Reset own revisions?',
            buttons: {
              "Cancel": function () {
                $(this).dialog('destroy');
              },
              "Remove all of my reviews": function () {
                submit(django_url + self.projectId + "/skeleton/" + self.currentSkeletonId + "/review/" + fnName, "POST", {},
                  function (json) {
                    self.startReviewActiveSkeleton();
                  });
                $(this).dialog('destroy');
              }
            }
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
      var reviewedByCurrentUser = reviewedByUser.bind(self, CATMAID.session.userid);

      for(var idx in self.skeleton_segments) {
        if( self.skeleton_segments[idx]['status'] !== "100.00" ) {
          if( startsegment == -1)
            startsegment = idx;
          var seq = self.skeleton_segments[idx]['sequence'];
          for(var i = 0; i < self.skeleton_segments[idx]['nr_nodes']; i++ ) {
            if(!seq[i]['rids'].some(reviewedByCurrentUser)) {
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
      project.getStackViewers().forEach(function(stackViewer) {
        var tilelayer = stackViewer.getLayer('TileLayer');
        // Create loading information text for each stack viewer.
        var layerCounter = document.createElement('div');
        counterContainer.append(layerCounter);
        if (tilelayer) {
          tilelayer.cacheLocations(locations,
              loadImageCallback.bind(self, layerCounter, stackViewer.primaryStack.title));
        }
      });
    };


    // Register to the active node change event
    SkeletonAnnotations.on(SkeletonAnnotations.EVENT_ACTIVE_NODE_CHANGED,
      this.handleActiveNodeChange, this);
  };

  CATMAID.ReviewSystem.prototype = new InstanceRegistry();

  CATMAID.ReviewSystem.prototype.getName = function() {
    return "Review System " + this.widgetID;
  };

  CATMAID.ReviewSystem.prototype.getWidgetConfiguration = function() {
    return {
      controlsID: "review_widget_buttons",
      createControls: function(controls) {
        var self = this;
        var tabs = CATMAID.DOM.addTabGroup(controls, '-review', ['Node review', 'Skeleton analytics']);

        CATMAID.DOM.appendToTab(tabs['Node review'], [{
            type: 'button',
            label: 'Start to review skeleton',
            onclick: this.startReviewActiveSkeleton.bind(this, false)
          }, {
            type: 'button',
            label: 'Start to review current sub-arbor',
            onclick:  this.startReviewActiveSkeleton.bind(this, true)
          }, {
            type: 'button',
            label: 'End review',
            onclick: this.endReview.bind(this)
          }, {
            type: 'button',
            label: 'Reset own revisions',
            onclick: this.resetOwnRevisions.bind(this)
          }, {
            type: 'numeric',
            label: 'Virtual node step',
            value: this.virtualNodeStep,
            length: 3,
            onchange: function() {
              self.virtualNodeStep = parseInt(this.value, 10);
            }
          }, {
            type: 'checkbox',
            label: 'Save review updates',
            title: 'If checked, all review updates are saved to the server. Otherwise all new review information is lost when the widget is closed or the review ended!',
            value: this.persistReview,
            onclick: function() { self.persistReview = this.checked; self.redraw(); }
          }, {
            type: 'checkbox',
            label: 'Auto centering',
            value: this.getAutoCentering(),
            onclick: function() { self.setAutoCentering(this.checked); }
          }, {
            type: 'checkbox',
            label: 'Cache tiles',
            value: false,
            onclick: this.cacheImages.bind(this)
          }, {
            type: 'checkbox',
            label: 'No refresh after segment done',
            value: this.noRefreshBetwenSegments,
            onclick: function() {
              self.noRefreshBetwenSegments = this.checked;
            }
          }, {
            type: 'checkbox',
            label: 'Upstream review',
            value: this.reviewUpstream,
            onclick: function() {
              self.reviewUpstream = this.checked;
            }
          }, {
            type: 'checkbox',
            label: 'Apply node filters',
            value: this.applyFilterRules,
            onclick: function() {
              self.applyFilterRules = this.checked;
              if (self.filterRules.length > 0) {
                if (this.checked) {
                  self.updateFilter();
                } else {
                  self.update();
                }
              }
            }
          }
        ]);
        tabs['Node review'].dataset.mode = 'node-review';

        // Skeleton analytics
        var adjacents = [];
        for (var i=0; i<5; ++i) adjacents.push(i);
        tabs['Skeleton analytics'].dataset.mode = 'analytics';
        CATMAID.DOM.appendToTab(tabs['Skeleton analytics'], [{
            type: 'child',
            element: CATMAID.skeletonListSources.createSelect(this)
          }, {
            type: 'select',
            id: 'extra' + this.widgetID,
            label: 'Extra',
            title: 'List problems with connected neurons',
            entries: [
              {title: "No others", value: 0},
              {title: "Downstream skeletons", value: 1},
              {title: "Upstream skeletons", value: 2},
              {title: "Both upstream and downstream", value: 3}
            ]
          }, {
            type: 'select',
            id: 'adjacents' + this.widgetID,
            label: 'Adjacents',
            title: 'Maximum distance (hops) from a node when checking of duplicate connectors',
            entries: adjacents
          }, {
            type: 'button',
            label: 'Update',
            onclick: this.reloadSkeletonAnalyticsData.bind(this)
          }
        ]);

        $(controls).tabs({
          activate: function(event, ui) {
            var mode = ui.newPanel.attr('data-mode');
            if (mode === 'node-review' || mode === 'analytics') {
              self.mode = mode;
              self.redraw();
            }
          }
        });
      },
      contentID: "review_widget",
      createContent: function(content) {
        var self = this;

        this._content = content;

        // Node review container
        this.nodeReviewContainer = document.createElement('div');
        this.nodeReviewContainer.style.display = 'none';

        var cacheCounter = document.createElement('div');
        cacheCounter.setAttribute("id", "counting-cache");
        this.nodeReviewContainer.appendChild(cacheCounter);

        var persistenceWarning = document.createElement('div');
        persistenceWarning.setAttribute("class", "warning");
        persistenceWarning.style.color = "rgb(255, 93, 0)";
        persistenceWarning.style.textAlign = "center";
        persistenceWarning.appendChild(document.createTextNode(
            'Warning: review changes are not saved to server!'));
        this.nodeReviewContainer.appendChild(persistenceWarning);

        var cacheInfoCounter = document.createElement('div');
        cacheInfoCounter.setAttribute("id", "counting-cache-info");
        this.nodeReviewContainer.appendChild(cacheInfoCounter);

        var label = document.createElement('div');
        label.setAttribute("id", "reviewing_skeleton");
        label.classList.add('review-block');
        this.nodeReviewContainer.appendChild(label);

        // Add note about virtual nodes not being counted
        var note = document.createElement('div');
        note.classList.add('review-block');
        note.innerHTML = "<em class=\"help\">Note: Virtual nodes are selected " +
            "during review, but don't contribute to the node count. They can " +
            "be skipped by changing the 'Virtual node step' setting.</em>";
        this.nodeReviewContainer.appendChild(note);

        var table = document.createElement("div");
        table.setAttribute("id", "project_review_widget");
        table.classList.add('review-block');
        table.style.position = "relative";
        table.style.width = "100%";
        table.style.overflow = "auto";
        table.style.backgroundColor = "#ffffff";
        this.nodeReviewContainer.appendChild(table);

        content.appendChild(this.nodeReviewContainer);

        // Skeleton analytics
        this.analyticsContainer = document.createElement('div');
        this.analyticsContainer.innerHTML =
          '<table cellpadding="0" cellspacing="0" border="0" class="display" id="skeletonanalyticstable' + this.widgetID + '">' +
            '<thead>' +
              '<tr>' +
                '<th>Issue</th>' +
                '<th>Neuron ID</th>' +
                '<th>Treenode ID</th>' +
                '<th>Skeleton ID</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' +
            '</tbody>' +
            '<tfoot>' +
              '<tr>' +
                '<th>Issue</th>' +
                '<th>Neuron ID</th>' +
                '<th>Treenode ID</th>' +
                '<th>Skeleton ID</th>' +
              '</tr>' +
            '</tfoot>' +
          '</table>';
        this.skeletonAnalyticsTable = $('table', this.analyticsContainer).DataTable({
          destroy: true,
          dom: 'lfrtip',
          processing: true,
          // Enable sorting locally, and prevent sorting from calling the
          // fnServerData to reload the table -- an expensive and undesirable
          // operation.
          serverSide: false,
          autoWidth: false,
          pageLength: -1,
          lengthMenu: [CATMAID.pageLengthOptions, CATMAID.pageLengthLabels],
          columns: [
            { // Type
              "searchable": true,
              "sortable": true
            },
            { // Neuron name
              "searchable": true,
              "sortable": true
            },
            { // Treenode ID
              "searchable": true,
              "sortable": true,
            },
            { // Skeleton ID
              "searchable": true,
              "sortable": true
            }
          ]
        });

        /** Make rows double-clickable to go to the treenode location and select it. */
        var table = this.skeletonAnalyticsTable;
        $('table tbody', this.analyticsContainer).on('dblclick', 'tr', function() {
          var data = table.row(this).data();
          var tnid = parseInt(data[2]);
          var skeleton_id = parseInt(data[3]);
          CATMAID.fetch(project.id + '/node/get_location', 'POST',
              { tnid: tnid }, false, "skeleton_analytics_go_to_node")
            .then(function(json) {
              SkeletonAnnotations.staticMoveTo(json[3], json[2], json[1]);
            })
            .then(function() {
              SkeletonAnnotations.staticSelectNode(tnid, skeleton_id);
            })
            .catch(CATMAID.handleError);
        });

        content.appendChild(this.analyticsContainer);
      },
      init: function() {
        this.init();
      },
      filter: {
        rules: this.filterRules,
        update: this.updateFilter.bind(this)
      }
    };
  };

  /**
   * Redraw the review widget.
   */
  CATMAID.ReviewSystem.prototype.redraw = function() {
    if (this.mode === 'node-review') {
      this.nodeReviewContainer.style.display = this.currentSkeletonId ? 'block' : 'none';
      this.analyticsContainer.style.display = 'none';
      $('.warning', this.nodeReviewContainer).css('display',
          this.persistReview ? 'none' : 'block');
    } else if (this.mode === 'analytics') {
      this.nodeReviewContainer.style.display = 'none';
      this.analyticsContainer.style.display = 'block';
    }
  };

  /**
   * Reevaluate the current set of node filter rules to update the set of
   * excluded nodes.
   */
  CATMAID.ReviewSystem.prototype.updateFilter = function(options) {
    if (!this.currentSkeletonId || this.filterRules.length === 0) {
      return Promise.resolve();
    }

    var self = this;
    var skeletonsIds = [this.currentSkeletonI];

    return CATMAID.SkeletonFilter.fetchArbors(skeletonIds)
      .then(function(arbors) {
        var filter = new CATMAID.SkeletonFilter(self.filterRules, skeletons);

        if (!arbors) {
          throw new CATMAID.ValueError("Couldn't fetch skeleton arbor");
        }
        var filteredNodes = filter.execute(arbors, self.filterRules);
        self.allowedNodes = new Set(Object.keys(filteredNodes.nodes).map(function(n) {
          return parseInt(n, 10);
        }));
        if (0 === self.allowedNodes.length) {
          CATMAID.warn("No points left after filter application");
        }
        self.update();
      })
      .catch(CATMAID.handleError);
  };

  // Available stack orientations
  var orientations = {
    "0": "XY",
    "1": "XZ",
    "2": "ZY"
  };

  /**
   * Return a title for a given issue
   */
  function getIssueLabel(type, name, details) {
    if (8 === type) {
      // Node in broken section
      return name + " " + details.section + " of " +
          orientations[details.orientation] + " stack \"" +
          details.stack_title  + "\" (id: " + details.stack + ")";
    } else {
      return name;
    }
  }

  /**
   * Refresh the skeleton analytics data based on the current settings.
   */
  CATMAID.ReviewSystem.prototype.reloadSkeletonAnalyticsData = function() {
    var table = this.skeletonAnalyticsTable;
    if (!table) {
      CATMAID.warn("Couldn't find skeleton analytics table");
      return;
    }
    // Clear
    table.clear();
    // Reload
    var skids = CATMAID.skeletonListSources.getSelectedSource(this).getSelectedSkeletons();
    if (!skids || !skids[0]) {
      CATMAID.msg("Oops", "Select skeleton(s) first!");
      return;
    }
    // sSource is the sAjaxSource
    var extra = $('#Skeletonanalytics-review_extra' + this.widgetID).val();
    if (undefined === extra) {
      throw new CATMAID.Error("Couldn't find parameter 'extra'");
    }
    var adjacents = $('#Skeletonanalytics-review_adjacents' + this.widgetID).val();
    if (undefined === adjacents) {
      throw new CATMAID.Error("Couldn't find parameter 'adjacents'");
    }

    CATMAID.fetch(project.id + '/analytics/skeletons', 'POST', {
      skeleton_ids: skids,
      extra: extra,
      adjacents: adjacents
    }, false, 'skeleton_analytics_update', true)
    .then(function(json) {
      var rows = [];
      json.issues.forEach(function (sk) {
        // sk[0]: skeleton ID
        // sk[1]: array of pairs like [issue ID, treenode ID]
        // sk[2]: optional details
        var skeletonId = sk[0];
        var name = json.names[skeletonId];
        sk[1].forEach(function(issue) {
          var details = issue[2];
          var label = getIssueLabel(issue[0], json[issue[0]], details);
          rows.push([label, // issue label
                     name, // neuron name
                     issue[1], // treenode ID
                     sk[0]]); // skeleton ID
        });
      });

      if (rows.length > 0) {
        table.rows.add(rows);
      }
      table.draw();
    })
    .catch(CATMAID.handleError);
  };

  // Allow access to the last active instance
  var lastFocused = null;

  /**
   * Update reference to last focused instance.
   */
  CATMAID.ReviewSystem.prototype.focus = function() {
    lastFocused = this;
  };

  /**
   * Clear reference to last focused instance if this instance was the last
   * focused instance.
   */
  CATMAID.ReviewSystem.prototype.destroy = function() {
    if (lastFocused === this) {
      lastFocused = null;
    }
    this.unregisterInstance();
  };

  /**
   * Get the review widget that was focused last.
   */
  CATMAID.ReviewSystem.getLastFocused = function() {
    return lastFocused;
  };

  CATMAID.ReviewSystem.STATUS_COLOR_FULL    = '#6fff5c';
  CATMAID.ReviewSystem.STATUS_COLOR_PARTIAL = '#ffc71d';
  CATMAID.ReviewSystem.STATUS_COLOR_NONE    = '#ff8c8c';
  CATMAID.ReviewSystem.STATUS_COLOR_PARTIAL_8 = [
    '#ff9789', '#ffa286', '#ffaf83', '#ffbc80', '#ffc97d',
    '#ffd87a', '#ffe777', '#fff774', '#e6ff6e', '#d4ff6b'
  ];

  /**
   * Support function for selecting a background color based on review state.
   */
  CATMAID.ReviewSystem.getBackgroundColor = function(reviewed) {
    if (100 === reviewed) {
    return CATMAID.ReviewSystem.STATUS_COLOR_FULL;
    } else if (0 === reviewed) {
    return CATMAID.ReviewSystem.STATUS_COLOR_NONE;
    } else {
      if (CATMAID.ReviewSystem.Settings.session.detailed_review_colors) {
        // Get a color index in [0,9], mapping to review percentages 1 to 99
        var colorIndex = Math.max(0, Math.min(9, Math.floor(reviewed / 10)));
        return CATMAID.ReviewSystem.STATUS_COLOR_PARTIAL_8[colorIndex];
      } else {
        return CATMAID.ReviewSystem.STATUS_COLOR_PARTIAL;
      }
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

        if (!(userId in CATMAID.User.all())) {
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
        if (typeof project === 'undefined' || !project ||
            !CATMAID.session || !CATMAID.session.id) {
          whitelist = {};
          return;
        }

        CATMAID.fetch(project.id + '/user/reviewer-whitelist')
          .then(function(json) {
            whitelist = json.reduce(function (wl, entry) {
              wl[entry.reviewer_id] = new Date(entry.accept_after);
              return wl;
            }, {});
            if (typeof callback === 'function') callback();
          })
          .catch(CATMAID.handleError);
      },

      /**
       * Saves the current state of the whitelist to the server.
       */
      save: function (callback) {
        // If no user is logged in, do not attempt to save the whitelist.
        if (!CATMAID.session || !CATMAID.session.id) return;

        var encodedWhitelist = Object.keys(whitelist).reduce(function (ewl, userId) {
          ewl[userId] = whitelist[userId].toISOString();
          return ewl;
        }, {});
        CATMAID.fetch(project.id + '/user/reviewer-whitelist', 'POST',
            encodedWhitelist, false, 'reviewerwhitelist' + project.id, true)
          .then(callback)
          .catch(CATMAID.handleError);
      }
    };
  })();

  CATMAID.ReviewSystem.Settings = new CATMAID.Settings(
    'review',
    {
      version: 0,
      entries: {
        detailed_review_colors: {
          default: false
        }
      },
      migrations: {}
    });

  CATMAID.Init.on(CATMAID.Init.EVENT_PROJECT_CHANGED, CATMAID.ReviewSystem.Whitelist.refresh);
  CATMAID.Init.on(CATMAID.Init.EVENT_USER_CHANGED, CATMAID.ReviewSystem.Whitelist.refresh);

  CATMAID.registerWidget({
    key: "review-system",
    creator: CATMAID.ReviewSystem
  });

})(CATMAID);
