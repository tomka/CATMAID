<?php

/**
 * tools.inc.php
 *
 * @author Stephan Saalfeld <saalfeld@mpi-cbg.de>
 * @copyright Copyright (c) 2007, Stephan Saalfeld
 * @version 0.1 TrakEM2
 *
 */

/**
 * create a tree view node
 */
function tv_node( $data )
{
	// print_r( $data );
	$sOutput = '';
	$sOutput .= '{';	
	if( array_key_exists('data', $data) )
	{
		$sOutput .= '"data":{';
		if( array_key_exists('title', $data['data']))
		{
			$sOutput .= '"title":'.json_encode($data['data']['title']);
		}
		
		if( array_key_exists('icon', $data['data']))
		{
			$sOutput .= ',"icon":'.json_encode($data['data']['icon']);
		}
		
		$sOutput .= '}';
	};
	
	if( array_key_exists('attr', $data))
	{
		$sOutput .= ',"attr":{';
		$i = 0;
		foreach($data['attr'] as $key => $aval)
		{
			if($i!=0) { $sOutput .= ','; }
			$sOutput .= json_encode($key)." : ".json_encode($aval);
			$i++;
		}
		$sOutput .= '}';
	}		
	
	if( array_key_exists('state', $data))
	{
		$sOutput .= ',"state":'.json_encode($data['state']);
	}
	
	if( array_key_exists('children', $data) )
	{
		$sOutput .= '",children":[';
		// add the children here
		foreach ($data['children'] as $key => $value ) {
			$sOutput .= tv_node($value);	
		};
		$sOutput .= ']';
	}
	
	$sOutput .= '}';
	
	return $sOutput;
			
}
/**
 * create a x,y,z assoziative float array from a trakem2-postgres double3d(x,y,z)
 *
 * @return array
 */
function double3dXYZ( $double3d )
{
	$double3d = str_replace( '(', '', $double3d );
	$double3d = str_replace( ')', '', $double3d );
	$double3d = explode( ',', $double3d );
	
	return array(
		'x' => floatval( $double3d[ 0 ] ),
		'y' => floatval( $double3d[ 1 ] ),
		'z' => floatval( $double3d[ 2 ] ) );
}

/**
 * create a x,y,z assoziative integer array from a trakem2-postgres integer3d(x,y,z)
 * 
 * @return array
 */
function integer3dXYZ( $integer3d )
{
	$integer3d = str_replace( '(', '', $integer3d );
	$integer3d = str_replace( ')', '', $integer3d );
	$integer3d = explode( ',', $integer3d );
	
	return array(
		'x' => intval( $integer3d[ 0 ] ),
		'y' => intval( $integer3d[ 1 ] ),
		'z' => intval( $integer3d[ 2 ] ) );
}

/** 
 * Get all files of a given directory .
 * 
 * @return array 
 */
function getFileList( $path )
{
    $dir = opendir( $path );
    $entry = readdir( $dir);
    $list = array();
    while ( $entry != '' )
    {
        if ( $entry != '.' && $entry != '..' )
            if ( is_file( $path.'/'.$entry ) ) $list[] = $entry;
        $entry = readdir( $dir );
    }
    closedir( $dir );
    sort( $list );
    return $list;
}

/**
 * Checks if the given URL exists.
 */
function url_exists($url) {
  $a_url = parse_url($url);
  if (!isset($a_url['port'])) $a_url['port'] = 80;
  $errno = 0;
  $errstr = '';
  $timeout = 30;
  if(isset($a_url['host']) && $a_url['host']!=gethostbyname($a_url['host'])){
     $fid = fsockopen($a_url['host'], $a_url['port'], $errno, $errstr, $timeout);
     if (!$fid) return false;
     $page = isset($a_url['path'])  ?$a_url['path']:'';
     $page .= isset($a_url['query'])?'?'.$a_url['query']:'';
     fputs($fid, 'HEAD '.$page.' HTTP/1.0'."\r\n".'Host: '.$a_url['host']."\r\n\r\n");
     $head = fread($fid, 4096);
     fclose($fid);
     if (preg_match('#^HTTP/.*\s+[200|302]+\s#i', $head)) {
      $pos = strpos($head, 'Content-Type');
      return $pos !== false;
     }
  }
  return false;
}

