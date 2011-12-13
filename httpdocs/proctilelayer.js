/**
 * proctilelayer.js
 *
 * requirements:
 *	 tilelayer.js
 *
 */

/**
 * A tile layer that allows on-the-fly processing of the
 * stack's tiles by calling a manipulation script.
 */
function ProcTileLayer(
		stack,						//!< reference to the parent stack
		baseURL,					//!< base URL for image tiles
		tileWidth,
		tileHeight,
		fileExtension
		)
{
	var that = new TileLayer(stack, baseURL, tileWidth,
		tileHeight, fileExtension);

	that.getTileURL = function(tileId) {
			url = "model/imageproc.php?url=" + that.baseURL + tileId
						+ "." + fileExtension
						+ "&type=" + fileExtension;
			return url;
		};

	return that;
}

