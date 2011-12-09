<?php

include_once( 'errors.inc.php' );
include_once( 'db.pg.class.php' );
include_once( 'session.class.php' );
include_once( 'tools.inc.php' );
include_once( 'json.inc.php' );
include_once( 'utils.php' );

$db =& getDB();
$ses =& getSession();

/*
$pid = isset( $_POST[ 'pid' ] ) ? intval( $_POST[ 'pid' ] ) : 0;
$sid = isset( $_POST[ 'sid' ] ) ? intval( $_POST[ 'sid' ] ) : 0;
*/
$pid = isset( $_REQUEST[ 'pid' ] ) ? intval( $_REQUEST[ 'pid' ] ) : 0;
$sid = isset( $_REQUEST[ 'sid' ] ) ? intval( $_REQUEST[ 'sid' ] ) : 0;
$uid = $ses->isSessionValid() ? $ses->getId() : 0;

# Check preconditions:

# 1. There must be a stack id
if ( ! $sid ) {
	echo json_encode( array( 'error' => 'A stack ID has not been provided!' ) );
	return;
}

# 2. There must be a project id
if ( ! $pid ) {
  echo json_encode( array( 'error' => 'Project closed. Cannot apply operation.' ) );
	return;
}

// Start transaction
if (! $db->begin() ) {
	echo json_encode( array( 'error' => 'Could not start transaction.' ) );
	return;
}

try {

  $project_stacks = $db->getResult(
    'SELECT	DISTINCT ON ( "pid", "sid" ) "project"."id" AS "pid",
        "stack"."id" AS "sid",
        "project"."title" AS "ptitle",
        "project_stack"."translation" AS "translation",
        "stack"."title" AS "stitle",
        "stack"."dimension" AS "dimension",
        "stack"."resolution" AS "resolution",
        "stack"."image_base" AS "image_base",
        "stack"."trakem2_project" AS "trakem2_project"
        
      FROM "project" LEFT JOIN "project_user"
          ON "project"."id" = "project_user"."project_id" INNER JOIN "project_stack"
            ON "project"."id" = "project_stack"."project_id" INNER JOIN "stack"
              ON "stack"."id" = "project_stack"."stack_id"
        
        WHERE	"project"."id" = '.$pid.' AND
            "stack"."id" = '.$sid.' AND
            ( "project_user"."user_id" = '.$uid.' OR
              "project"."public" )'
  );
  
  if (false === $project_stacks) {
    emitErrorAndExit($db, 'Failed to retrieve stack data.');
  }
  
  if ( $project_stacks )
  {
    $entryCount = $db->countEntries(
      'project_user',
      '"project_id" = '.$pid.' AND "user_id" = '.$uid );
      
    if (false === $entryCount) {
      emitErrorAndExit($db, 'Failed to count stack entries.');
    }

    $editable = $entryCount > 0;

    $broken_slices = $db->getResult(
      'SELECT "index" AS "i"
        
        FROM "broken_slice"
        
        WHERE	"stack_id" = '.$sid.'
        
        ORDER BY "i"'
    );
    
    if (false === $broken_slices) {
      emitErrorAndExit($db, 'Failed to select broken slices.');
    }
    
    $bs = array();
    foreach ( $broken_slices as $b )
    {
      $bs[ $b[ 'i' ] ] = 1;
    }

    // retrieve overlays
    $overlays = $db->getResult('SELECT id, title, image_base, default_opacity FROM overlay WHERE overlay.stack_id = '.$project_stacks[ 0 ]['sid']);

    $project_stack = $project_stacks[ 0 ];
    $project_stack[ 'editable' ] = $editable;
    $project_stack[ 'translation' ] = double3dXYZ( $project_stack[ 'translation' ] );
    $project_stack[ 'resolution' ] = double3dXYZ( $project_stack[ 'resolution' ] );
    $project_stack[ 'dimension' ] = integer3dXYZ( $project_stack[ 'dimension' ] );
	$project_stack[ 'tile_width' ] = 256;
	$project_stack[ 'tile_height' ] = 256;    
	$project_stack[ 'broken_slices' ] = $bs;
    $project_stack[ 'trakem2_project' ] = $project_stack[ 'trakem2_project' ] == 't';
    $project_stack[ 'overlay' ] = $overlays;

    if (! $db->commit() ) {
      emitErrorAndExit( $db, 'Failed to commit!' );
    }

   /* Find out what file type is used by looking at the files that are
    * stored under the image_base path. We cannot rely on being able
    * to get a file list, so we rather test against a list of known
    * extensions.
    */
   function findExtension( $image_base ) {
     $known_extensions = array("jpg", "png", "gif", "bmp", "jpeg", "tif",
        "tiff","svg", "j2k");
     $raw_url = $image_base . "0/0_0_0.";
     foreach ( $known_extensions as $ext ) {
       $img_url = $raw_url . $ext;
       if( url_exists($img_url) ) {
         // we found a valid file format
         return $ext;
       }
     }
     return "";
   }
   // find image file format of the project stack
   $file_extension = findExtension( $project_stack[ 'image_base' ] );
   if ($file_extension == "") {
      emitErrorAndExit( $db, 'Could not find image file format of data set!' );
   }
   $project_stack[ 'file_extension' ] = $file_extension;
   // find image file format of the overlays
   foreach ( $overlays as $ol ) {
     $file_extension = findExtension( $ol[ 'image_base' ] );
     if ($file_extension == "") {
        emitErrorAndExit( $db, 'Could not find image file format of overlay!' );
     }
     $ol[ 'file_extension' ] = $file_extension;
   }

   /* Check for the maximum available zoom level by trying which
    * zoom levels are available for the first picture.
    */
   $raw_url = $project_stack['image_base'] . "0/0_0_";
   $zoom_level = 0;
   while (true) {
     $img_url = $raw_url . $zoom_level . "." . $file_extension;
     $project_stack[ 'max_zoom_level_url' ] = $img_url;
     if( !url_exists($img_url) || $zoom_level > 10) {
       // the current zoom level does not exist
       // or 10 zoom levels reached (in case anything is wrong
       // with the url_exists() method
       $zoom_level--;
       break;
     }
     $zoom_level++;
   }
   $project_stack[ 'max_zoom_level' ] = $zoom_level;

    echo makeJSON( $project_stack );

  } else {
    echo emitErrorAndExit($db, 'Invalid project stack selection.' );
  }

} catch (Exception $e) {
	emitErrorAndExit( $db, 'ERROR: '.$e );
}

?>
